/**
 * Backfill embedding cho toàn bộ ảnh đối chứng trong plan_stage_diseases.
 *
 * Chạy:
 *   npm run embeddings:backfill -- --apply-schema            # tạo bảng + embed ảnh còn thiếu
 *   npm run embeddings:backfill -- --dry-run                 # chỉ thống kê
 *   npm run embeddings:backfill -- --crop "Sầu riêng"        # chỉ một loại cây
 *   npm run embeddings:backfill -- --force                   # embed lại tất cả
 *   npm run embeddings:backfill -- --env .env.production     # chọn file env (mặc định .env)
 *
 * Mặc định bỏ qua ảnh đã có vector cùng model_version (không tải lại ảnh).
 * Ảnh lỗi (link chết, không có quyền) được ghi log và bỏ qua, không dừng tiến trình.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { Pool } from 'pg';
import sharp from 'sharp';
import { toImageKey, toDownloadUrls } from '../src/common/utils/image-key';
import {
  EMBEDDING_MODEL as MODEL,
  EMBEDDING_MODEL_VERSION as MODEL_VERSION,
  EMBEDDING_DIMENSIONS as DIMENSIONS,
} from '../src/modules/embedding/embedding.constants';

const CONCURRENCY = 3;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const envFile = arg('env') ?? '.env';
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const apiKey = process.env.GEMINI_API_KEY;
const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!apiKey || !dbUrl) {
  console.error(`Thiếu GEMINI_API_KEY hoặc DATABASE_URL/DIRECT_URL (env file: ${envFile})`);
  process.exit(1);
}

const isRemote = !/localhost|127\.0\.0\.1/.test(dbUrl);
const pool = new Pool({
  connectionString: dbUrl.includes('uselibpqcompat') ? dbUrl : `${dbUrl}${dbUrl.includes('?') ? '&' : '?'}uselibpqcompat=true`,
  ssl: isRemote ? { rejectUnauthorized: false } : undefined,
  max: 4,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function download(rawUrl: string): Promise<Buffer | null> {
  for (const url of toDownloadUrls(rawUrl)) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) continue;
      const type = res.headers.get('content-type') ?? '';
      if (type && !type.startsWith('image/')) continue; // Drive trả HTML khi không có quyền
      return Buffer.from(await res.arrayBuffer());
    } catch {
      /* thử URL kế tiếp */
    }
  }
  return null;
}

async function embed(original: Buffer): Promise<number[]> {
  const jpeg = await sharp(original)
    .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  const body = JSON.stringify({
    content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } }] },
    outputDimensionality: DIMENSIONS,
  });

  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey as string },
        body,
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (res.ok) {
      const json: any = await res.json();
      const values: number[] | undefined = json?.embedding?.values;
      if (!values || values.length !== DIMENSIONS) throw new Error('Embedding không hợp lệ');
      return values;
    }
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
      await sleep(Math.min(waitMs, 60_000));
      continue;
    }
    throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  throw new Error('Hết số lần thử embedding');
}

async function main() {
  if (flag('apply-schema')) {
    const sql = fs.readFileSync(path.join(__dirname, 'sql', '001_reference_image_embeddings.sql'), 'utf8');
    await pool.query(sql);
    console.log('Đã áp schema reference_image_embeddings.');
  }

  const crop = arg('crop');
  const rows = (
    await pool.query(
      `SELECT crop_type, unnest(image_urls) AS url
       FROM plan_stage_diseases
       WHERE cardinality(image_urls) > 0
         AND ($1::text IS NULL OR lower(crop_type) = lower($1))`,
      [crop ?? null],
    )
  ).rows as { crop_type: string; url: string }[];

  // Khử trùng theo khóa ảnh
  const byKey = new Map<string, { url: string; crop: string }>();
  for (const r of rows) {
    const key = toImageKey(r.url);
    if (key && !byKey.has(key)) byKey.set(key, { url: r.url, crop: r.crop_type });
  }

  const existing = new Set<string>(
    flag('force')
      ? []
      : (
          await pool.query(`SELECT image_key FROM reference_image_embeddings WHERE model_version = $1`, [MODEL_VERSION])
        ).rows.map((r: any) => r.image_key),
  );

  const todo = [...byKey.entries()].filter(([key]) => !existing.has(key));
  console.log(
    `Ảnh trong kho: ${rows.length} dòng URL → ${byKey.size} ảnh duy nhất | đã có vector: ${byKey.size - todo.length} | cần xử lý: ${todo.length}`,
  );
  if (flag('dry-run')) return;

  let ok = 0;
  const failed: { url: string; crop: string; reason: string }[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < todo.length) {
      const [key, item] = todo[cursor++];
      try {
        const buf = await download(item.url);
        if (!buf) throw new Error('Không tải được ảnh (link chết hoặc không có quyền)');
        const hash = createHash('sha256').update(buf).digest('hex');
        const vec = await embed(buf);
        await pool.query(
          `INSERT INTO reference_image_embeddings (image_key, image_url, image_hash, embedding, dimensions, model_version)
           VALUES ($1, $2, $3, $4::real[], $5, $6)
           ON CONFLICT (image_key) DO UPDATE SET
             image_url = EXCLUDED.image_url, image_hash = EXCLUDED.image_hash,
             embedding = EXCLUDED.embedding, dimensions = EXCLUDED.dimensions,
             model_version = EXCLUDED.model_version, updated_at = NOW()`,
          [key, item.url, hash, vec, DIMENSIONS, MODEL_VERSION],
        );
        ok++;
      } catch (err: any) {
        failed.push({ url: item.url, crop: item.crop, reason: err.message });
      }
      const done = ok + failed.length;
      if (done % 10 === 0 || done === todo.length) console.log(`  ${done}/${todo.length} (lỗi: ${failed.length})`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`\nHoàn tất: thành công ${ok}, lỗi ${failed.length}.`);
  if (failed.length) {
    const report = path.join(__dirname, 'backfill-failures.json');
    fs.writeFileSync(report, JSON.stringify(failed, null, 2));
    console.log(`Danh sách ảnh lỗi: ${report}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
