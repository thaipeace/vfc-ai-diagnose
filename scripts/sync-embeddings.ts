/**
 * Đồng bộ toàn bộ vector từ DB local sang DB từ xa (Staging / Production)
 * mà KHÔNG cần gọi lại Gemini API để embed lại.
 *
 * Cách dùng:
 *   npx ts-node scripts/sync-embeddings.ts --target-env .env.production --dry-run
 *   npx ts-node scripts/sync-embeddings.ts --target-env .env.production --apply-schema
 */
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { EMBEDDING_MODEL_VERSION } from '../src/modules/embedding/embedding.constants';
import { toImageKey } from '../src/common/utils/image-key';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

// 1. Xác định source DB (Local Postgres chứa 924 vector)
if (fs.existsSync('.env')) process.loadEnvFile('.env');

let sourceDbUrl: string = arg('source-url') || '';
if (!sourceDbUrl && arg('source-env')) {
  const c = fs.readFileSync(arg('source-env')!, 'utf8');
  const m = c.match(/(?:DIRECT_URL|DATABASE_URL)\s*=\s*["']?([^"'\r\n]+)["']?/);
  if (m) sourceDbUrl = m[1].trim();
}
if (!sourceDbUrl) {
  const envUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (envUrl && /localhost|127\.0\.0\.1/.test(envUrl)) {
    sourceDbUrl = envUrl;
  } else if (fs.existsSync(path.join(__dirname, '..', '..', 'vfc-fs', '.env'))) {
    const fsEnv = fs.readFileSync(path.join(__dirname, '..', '..', 'vfc-fs', '.env'), 'utf8');
    const m = fsEnv.match(/(?:DIRECT_URL|DATABASE_URL)\s*=\s*["']?([^"'\r\n]+)["']?/);
    if (m && /localhost|127\.0\.0\.1/.test(m[1])) sourceDbUrl = m[1].trim();
  }
  if (!sourceDbUrl) {
    sourceDbUrl = 'postgresql://postgres:1111@localhost:5432/vfcfs?schema=public';
  }
}

// 2. Xác định target DB (Staging / Production)
const targetEnvFile = arg('target-env') || '.env.production';
if (!fs.existsSync(targetEnvFile)) {
  console.error(`Không tìm thấy target env file: ${targetEnvFile}`);
  process.exit(1);
}

const targetContent = fs.readFileSync(targetEnvFile, 'utf8');
const targetMatch = targetContent.match(/(?:DIRECT_URL|DATABASE_URL)\s*=\s*["']?([^"'\r\n]+)["']?/);
if (!targetMatch) {
  console.error(`Không tìm thấy DIRECT_URL hoặc DATABASE_URL trong ${targetEnvFile}`);
  process.exit(1);
}
const targetDbUrl = targetMatch[1].trim();

if (sourceDbUrl.replace(/\?.*$/, '') === targetDbUrl.replace(/\?.*$/, '')) {
  console.error('✗ LỖI: Source DB và Target DB đang trỏ vào cùng một database!');
  console.error('Hãy chỉ định rõ --source-url hoặc kiểm tra lại file cấu hình.');
  process.exit(1);
}

const isRemote = (url: string) => !/localhost|127\.0\.0\.1/.test(url);
const cleanUrl = (url: string) =>
  url.includes('uselibpqcompat') ? url : `${url}${url.includes('?') ? '&' : '?'}uselibpqcompat=true`;

const localPool = new Pool({
  connectionString: cleanUrl(sourceDbUrl),
  ssl: isRemote(sourceDbUrl) ? { rejectUnauthorized: false } : undefined,
  max: 2,
});

const targetPool = new Pool({
  connectionString: cleanUrl(targetDbUrl),
  ssl: isRemote(targetDbUrl) ? { rejectUnauthorized: false } : undefined,
  max: 4,
});

async function main() {
  console.log(`\n=== ĐỒNG BỘ VECTOR TỪ LOCAL SANG TARGET ===`);
  console.log(`Local DB : ${sourceDbUrl.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`Target DB: ${targetDbUrl.replace(/:[^:@]+@/, ':***@')} (${targetEnvFile})\n`);

  // Tạo bảng trên target nếu cần
  if (flag('apply-schema')) {
    console.log('Đang kiểm tra / tạo bảng trên Target DB...');
    const ddl = fs.readFileSync(path.join(__dirname, 'sql', '001_reference_image_embeddings.sql'), 'utf8');
    await targetPool.query(ddl);
    console.log('✓ Bảng reference_image_embeddings trên Target DB đã sẵn sàng.\n');
  }

  // Đọc danh sách vector từ Local
  const localRes = await localPool.query(
    `SELECT image_key, image_url, image_hash, embedding, dimensions, model_version, created_at, updated_at
     FROM reference_image_embeddings
     WHERE model_version = $1`,
    [EMBEDDING_MODEL_VERSION],
  );
  console.log(`Tìm thấy ${localRes.rows.length} vector hợp lệ trên Local DB (model: ${EMBEDDING_MODEL_VERSION}).`);

  if (localRes.rows.length === 0) {
    console.log('Không có vector nào trên Local DB để sync.');
    return;
  }

  // Kiểm tra target DB hiện có bao nhiêu vector
  let targetExistingKeys = new Set<string>();
  try {
    const targetCheck = await targetPool.query(
      `SELECT image_key FROM reference_image_embeddings WHERE model_version = $1`,
      [EMBEDDING_MODEL_VERSION],
    );
    targetExistingKeys = new Set(targetCheck.rows.map((r) => r.image_key));
    console.log(`Target DB hiện có ${targetExistingKeys.size} vector.`);
  } catch (err: any) {
    if (err?.code === '42P01') {
      console.error('✗ Bảng reference_image_embeddings chưa tồn tại trên Target DB! Hãy chạy lại kèm --apply-schema');
      process.exit(1);
    }
    throw err;
  }

  const toInsert = localRes.rows.filter((r) => !targetExistingKeys.has(r.image_key));
  console.log(`Số vector cần đồng bộ sang Target: ${toInsert.length}\n`);

  if (flag('dry-run')) {
    console.log('[DRY-RUN] Không ghi dữ liệu thực tế.');
  } else if (toInsert.length > 0) {
    console.log(`Bắt đầu chuyển ${toInsert.length} vector sang Target...`);
    const batchSize = 100;
    for (let i = 0; i < toInsert.length; i += batchSize) {
      const batch = toInsert.slice(i, i + batchSize);
      const client = await targetPool.connect();
      try {
        await client.query('BEGIN');
        for (const row of batch) {
          await client.query(
            `INSERT INTO reference_image_embeddings
             (image_key, image_url, image_hash, embedding, dimensions, model_version, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (image_key) DO UPDATE SET
               embedding = EXCLUDED.embedding,
               dimensions = EXCLUDED.dimensions,
               model_version = EXCLUDED.model_version,
               updated_at = NOW()`,
            [
              row.image_key,
              row.image_url,
              row.image_hash,
              row.embedding,
              row.dimensions,
              row.model_version,
              row.created_at,
              row.updated_at,
            ],
          );
        }
        await client.query('COMMIT');
        console.log(`  Đã chuyển ${Math.min(i + batchSize, toInsert.length)}/${toInsert.length}...`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
    console.log(`\n✓ Hoàn tất đồng bộ ${toInsert.length} vector sang Target DB!`);
  } else {
    console.log('Target DB đã đủ tất cả vector từ Local, không cần ghi thêm.');
  }

  // Kiểm tra độ phủ trên target DB đối chiếu với plan_stage_diseases của target DB
  console.log('\n--- KIỂM TRA ĐỘ PHỦ TRÊN TARGET DB ---');
  const targetDiseases = await targetPool.query(
    `SELECT crop_type, image_urls FROM plan_stage_diseases WHERE image_urls IS NOT NULL`,
  );
  const byCrop = new Map<string, Set<string>>();
  for (const r of targetDiseases.rows) {
    const crop = r.crop_type || 'Unknown';
    if (!byCrop.has(crop)) byCrop.set(crop, new Set());
    const urls: string[] = Array.isArray(r.image_urls) ? r.image_urls : [];
    for (const u of urls) byCrop.get(crop)!.add(toImageKey(u));
  }

  const allTargetKeys = new Set(
    (await targetPool.query(`SELECT image_key FROM reference_image_embeddings WHERE model_version = $1`, [EMBEDDING_MODEL_VERSION]))
      .rows.map((r) => r.image_key),
  );

  for (const [crop, keys] of byCrop.entries()) {
    let matched = 0;
    for (const k of keys) if (allTargetKeys.has(k)) matched++;
    const pct = keys.size ? ((matched / keys.size) * 100).toFixed(1) : '100';
    console.log(`  ${crop.padEnd(16)}: ${matched}/${keys.size} ảnh có vector (${pct}%)`);
  }
}

main()
  .catch((e) => {
    console.error('Lỗi sync:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await localPool.end();
    await targetPool.end();
  });
