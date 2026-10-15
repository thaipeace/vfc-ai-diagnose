/**
 * Chạy thử toàn luồng: ảnh → truy xuất ảnh đối chứng theo vector → prompt → Gemini chẩn đoán.
 * Dùng đúng các service của worker (ReferenceRetrievalService, AIEngineService, AIRouterService),
 * chỉ bỏ phần ghi DB/khớp sản phẩm.
 *
 *   npm run e2e:retrieval -- --mode real              # ảnh thật trong ../deseases (cần quota embedding)
 *   npm run e2e:retrieval -- --mode recall            # đo recall leave-one-out, KHÔNG gọi Gemini
 *   npm run e2e:retrieval -- --mode store --samples 4 # leave-one-out + gọi Gemini chẩn đoán (không tốn quota embedding)
 *
 * Tùy chọn: --crops "Lúa,Sầu riêng"  --dir ../deseases  --no-diagnose
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import sharp from 'sharp';
import { aiConfig } from '../src/config/ai.config';
import { PrismaModule } from '../src/modules/prisma/prisma.module';
import { PrismaService } from '../src/modules/prisma/prisma.service';
import { ImageModule } from '../src/modules/image/image.module';
import { ImageService } from '../src/modules/image/image.service';
import { AIModule } from '../src/modules/ai/ai.module';
import { AIEngineService } from '../src/modules/ai/ai-engine.service';
import { AIRouterService } from '../src/modules/ai/ai-router.service';
import { EmbeddingModule } from '../src/modules/embedding/embedding.module';
import { ReferenceRetrievalService } from '../src/modules/embedding/reference-retrieval.service';
import { EMBEDDING_MODEL_VERSION } from '../src/modules/embedding/embedding.constants';
import { aggregateDiseases, AggregatedDisease } from '../src/common/utils/disease-aggregator';
import { toImageKey } from '../src/common/utils/image-key';
import { buildLegacyReferenceData } from '../src/modules/diagnosis/legacy-reference.builder';
import { ConfigService } from '@nestjs/config';

process.env.ENABLE_VECTOR_RETRIEVAL = 'true';

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

const MODE = arg('mode') ?? 'real';
const CROPS = (arg('crops') ?? 'Lúa,Sầu riêng').split(',').map((s) => s.trim());
const SAMPLES = Number(arg('samples') ?? 8);
const DIR = path.resolve(arg('dir') ?? path.join(__dirname, '..', '..', 'deseases'));
const DIAGNOSE = !flag('no-diagnose') && MODE !== 'recall';

/** Tiền tố tên file → loại cây; từ khóa bệnh kỳ vọng suy ra từ tên file (không đoán thì để trống). */
const FILE_CROPS: [string, string][] = [
  ['lua-', 'Lúa'],
  ['sau-rieng-', 'Sầu riêng'],
];
const FILE_EXPECTED: Record<string, string[]> = {
  'lua-dao-on-nhe-1': ['đạo ôn'],
  'sau-rieng-rong-tao': ['rong', 'tảo'],
  'sau-rieng-rong-tao-2': ['rong', 'tảo'],
  'sau-rieng-ray-xanh-ray-phan-trang': ['rầy'],
  'lua-anh-sau': ['sâu'],
};

const fold = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [aiConfig] }),
    PrismaModule,
    ImageModule,
    AIModule,
    EmbeddingModule,
  ],
})
class E2EModule {}

async function main() {
  const app = await NestFactory.createApplicationContext(E2EModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const retrieval = app.get(ReferenceRetrievalService);
  const imageService = app.get(ImageService);
  const config = app.get(ConfigService);
  const aiEngine = app.get(AIEngineService);
  const aiRouter = app.get(AIRouterService);

  const diseasesByCrop = new Map<string, AggregatedDisease[]>();
  async function diseasesOf(crop: string) {
    if (!diseasesByCrop.has(crop)) {
      const raw = await prisma.planStageDisease.findMany({
        where: { cropType: { equals: crop, mode: 'insensitive' } },
      });
      diseasesByCrop.set(crop, aggregateDiseases(raw as any));
    }
    return diseasesByCrop.get(crop)!;
  }

  async function storedVectors(keys: string[]): Promise<Map<string, number[]>> {
    const rows = await prisma.$queryRawUnsafe<{ image_key: string; embedding: number[] }[]>(
      `SELECT image_key, embedding FROM reference_image_embeddings WHERE model_version = $1 AND image_key = ANY($2::text[])`,
      EMBEDDING_MODEL_VERSION,
      keys,
    );
    return new Map(rows.map((r) => [r.image_key, r.embedding]));
  }

  async function diagnose(crop: string, userB64: string, retrievalResult: NonNullable<Awaited<ReturnType<typeof retrieval.retrieve>>>) {
    const referenceData = await retrieval.buildReferenceData(retrievalResult);
    const promptText = aiEngine.buildPrompt(crop, []);
    return aiRouter.diagnoseWithFallback({ userImages: [userB64], referenceData, cropType: crop, promptText });
  }

  const matches = (aiDisease: string | undefined, keywords: string[]) =>
    !!aiDisease && keywords.length > 0 && keywords.some((k) => fold(aiDisease).includes(fold(k)));

  // ───────────────────────── real ─────────────────────────
  if (MODE === 'real') {
    const files = fs
      .readdirSync(DIR)
      .filter((f) => /\.(jpe?g|png)$/i.test(f))
      .filter((f) => FILE_CROPS.some(([p]) => f.startsWith(p)));
    console.log(`Ảnh thật trong ${DIR}: ${files.length}\n`);

    for (const file of files) {
      const crop = FILE_CROPS.find(([p]) => file.startsWith(p))![1];
      const base = file.replace(/\.[^.]+$/, '');
      const expected = FILE_EXPECTED[base] ?? [];
      const userB64 = (
        await sharp(fs.readFileSync(path.join(DIR, file)))
          .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer()
      ).toString('base64');

      console.log(`━━ ${file}  [${crop}]  kỳ vọng: ${expected.join(' / ') || '(không rõ)'}`);
      const r = await retrieval.retrieve({ diseases: await diseasesOf(crop), userImages: [userB64] });
      if (!r) {
        console.log('   ✗ Truy xuất không thực hiện được (xem cảnh báo ở trên: hết quota / thiếu vector) → luồng dự phòng\n');
        continue;
      }
      console.log('   Top bệnh theo độ giống: ' + r.diseases.map((d) => `${d.disease.detail} ${d.score.toFixed(3)}`).join(' | '));
      const rank = r.diseases.findIndex((d) => matches(d.disease.detail, expected)) + 1;
      if (expected.length) console.log(`   Bệnh kỳ vọng nằm ở hạng: ${rank || 'NGOÀI top'}`);
      if (DIAGNOSE) {
        try {
          const ai = await diagnose(crop, userB64, r);
          console.log(`   Gemini: "${ai.disease}" | mức: ${ai.severity} | tin cậy: ${ai.confidence} | thuốc: ${ai.solutionSets?.flatMap((s) => s.products).join(', ') || '(không)'}`);
          if (expected.length) console.log(`   → ${matches(ai.disease, expected) ? '✓ ĐÚNG' : '✗ KHÁC kỳ vọng'}`);
        } catch (e) {
          console.log(`   ✗ Chẩn đoán lỗi: ${(e as Error).name}: ${(e as Error).message}`);
        }
      }
      console.log('');
    }
  }

  // ───────────────── recall / store (leave-one-out) ─────────────────
  if (MODE === 'recall' || MODE === 'store') {
    for (const crop of CROPS) {
      const diseases = await diseasesOf(crop);
      const keys = [...new Set(diseases.flatMap((d) => d.imageUrls.map(toImageKey)))];
      const vectors = await storedVectors(keys);

      // Chỉ đánh giá ảnh mà bệnh của nó còn ≥1 ảnh khác sau khi loại chính nó.
      const cases = diseases.flatMap((d) => {
        const own = [...new Set(d.imageUrls.map((u) => [toImageKey(u), u] as const).map((x) => x.join('|')))].map((s) => s.split('|'));
        return own.length >= 2
          ? own.filter(([k]) => vectors.has(k)).map(([key, url]) => ({ d, key, url }))
          : [];
      });

      if (MODE === 'recall') {
        let top1 = 0, top3 = 0, topK = 0;
        const missed = new Map<string, number>();
        for (const c of cases) {
          const r = await retrieval.retrieve({
            diseases,
            queryVector: vectors.get(c.key)!,
            excludeImageKeys: new Set([c.key]),
          });
          const rank = (r?.diseases.findIndex((x) => x.disease.diseaseKey === c.d.diseaseKey) ?? -1) + 1;
          if (rank === 1) top1++;
          if (rank >= 1 && rank <= 3) top3++;
          if (rank >= 1) topK++;
          else missed.set(c.d.detail, (missed.get(c.d.detail) ?? 0) + 1);
        }
        const n = cases.length || 1;
        console.log(`\n[${crop}] ${cases.length} ảnh đánh giá (${diseases.length} bệnh)`);
        console.log(`  Bệnh đúng ở top-1: ${((top1 / n) * 100).toFixed(1)}% | top-3: ${((top3 / n) * 100).toFixed(1)}% | trong top-8 gửi cho AI: ${((topK / n) * 100).toFixed(1)}%`);
        if (missed.size) console.log('  Bệnh bị sót nhiều nhất: ' + [...missed.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}(${v})`).join(', '));
      } else {
        // store: A/B trên cùng mẫu — luồng vector so với luồng cũ — ảnh đang kiểm tra bị ẩn khỏi CẢ HAI luồng
        const usable = cases.filter((c) => fold(c.d.detail) !== 'khong co');
        const byDisease = new Map<string, typeof cases>();
        for (const c of usable) byDisease.set(c.d.diseaseKey, [...(byDisease.get(c.d.diseaseKey) ?? []), c]);
        const lists = [...byDisease.values()];
        const step = Math.max(1, Math.floor(lists.length / SAMPLES));
        const picked = lists.filter((_, i) => i % step === 0).slice(0, SAMPLES).map((l) => l[0]);

        console.log(`\n[${crop}] ${picked.length} mẫu (leave-one-out, ${lists.length} bệnh có >=2 ảnh)`);
        const score = { vector: 0, legacy: 0, retrievalTop8: 0, n: 0 };
        for (const c of picked) {
          const userB64 = await imageService.fetchAndOptimize(c.url, { size: 512, quality: 85 });
          if (!userB64) { console.log(`  ✗ Không tải được ảnh ${c.url}`); continue; }

          // Ẩn ảnh đang kiểm tra khỏi luồng cũ (luồng vector đã loại qua excludeImageKeys)
          const hidden = diseases.map((d) => ({ ...d, imageUrls: d.imageUrls.filter((u) => toImageKey(u) !== c.key) }));

          const r = await retrieval.retrieve({ diseases, queryVector: vectors.get(c.key)!, excludeImageKeys: new Set([c.key]) });
          const rank = r ? r.diseases.findIndex((x) => x.disease.diseaseKey === c.d.diseaseKey) + 1 : 0;
          score.n++;
          if (rank) score.retrievalTop8++;
          let line = `  • Thực tế: ${c.d.detail} | hạng truy xuất: ${rank || 'NGOÀI top'}`;

          if (DIAGNOSE) {
            const hit = (ai: { disease?: string }) => matches(ai.disease, [c.d.detail]) || matches(c.d.detail, [ai.disease ?? '']);
            const promptText = aiEngine.buildPrompt(crop, []);

            const legacyRefs = await buildLegacyReferenceData(hidden, { imageService, config });
            const legacy = await aiRouter.diagnoseWithFallback({ userImages: [userB64], referenceData: legacyRefs, cropType: crop, promptText });
            const legacyHit = hit(legacy);
            if (legacyHit) score.legacy++;
            line += `\n      cũ   : "${legacy.disease}" (${legacy.confidence}, ${legacy.provider}) ${legacyHit ? '✓' : '✗'}`;

            if (r) {
              const vec = await aiRouter.diagnoseWithFallback({ userImages: [userB64], referenceData: await retrieval.buildReferenceData(r), cropType: crop, promptText });
              const vecHit = hit(vec);
              if (vecHit) score.vector++;
              line += `\n      vector: "${vec.disease}" (${vec.confidence}, ${vec.provider}) ${vecHit ? '✓' : '✗'}`;
            }
          }
          console.log(line);
        }
        if (DIAGNOSE) {
          console.log(`  ➜ ${crop}: luồng cũ ${score.legacy}/${score.n} | luồng vector ${score.vector}/${score.n} | bệnh đúng nằm trong top-8 truy xuất: ${score.retrievalTop8}/${score.n}`);
        }
      }
    }
  }

  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
