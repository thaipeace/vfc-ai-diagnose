import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ImageService } from '../image/image.service';
import { ImageEmbeddingService, EmbeddingUnavailableError } from './image-embedding.service';
import { EMBEDDING_MODEL_VERSION } from './embedding.constants';
import { ReferenceData } from '../ai/ai-provider.interface';
import { AggregatedDisease } from '../../common/utils/disease-aggregator';
import { toImageKey } from '../../common/utils/image-key';
import { mapConcurrent } from '../../common/utils/reference-sampler';
import {
  RankedDisease,
  averageVectors,
  rankDiseasesBySimilarity,
} from '../../common/utils/vector-retrieval';

export interface RetrievalResult {
  mode: 'vector';
  /** Tỉ lệ ảnh của cây đã có vector (0..1). */
  coverage: number;
  diseases: RankedDisease<AggregatedDisease>[];
}

export interface RetrieveParams {
  diseases: AggregatedDisease[];
  /** Ảnh nông dân (base64). Cần nếu không truyền queryVector. */
  userImages?: string[];
  /** Cho phép truyền sẵn vector truy vấn (dùng khi đánh giá offline). */
  queryVector?: number[];
  excludeImageKeys?: Set<string>;
  diagnosisId?: string;
}

const CACHE_TTL_MS = 10 * 60_000;

@Injectable()
export class ReferenceRetrievalService {
  private readonly logger = new Logger(ReferenceRetrievalService.name);
  private cache = new Map<string, Float32Array>();
  private cacheLoadedAt = 0;

  constructor(
    private prisma: PrismaService,
    private embedder: ImageEmbeddingService,
    private imageService: ImageService,
    private config: ConfigService,
  ) {}

  isEnabled(): boolean {
    return String(this.config.get('ENABLE_VECTOR_RETRIEVAL') ?? 'false') === 'true';
  }

  private num(name: string, fallback: number): number {
    const v = Number(this.config.get(name));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  }

  /**
   * Chọn bệnh và ảnh đối chứng giống ảnh nông dân nhất.
   * Trả về null khi không thể (thiếu vector, embedding lỗi/hết quota...) để người gọi dùng luồng dự phòng.
   */
  async retrieve(params: RetrieveParams): Promise<RetrievalResult | null> {
    const tag = `[Vector Retrieval] Diagnosis: ${params.diagnosisId ?? 'n/a'}`;
    const exclude = params.excludeImageKeys ?? new Set<string>();

    const keys = new Set<string>();
    for (const d of params.diseases) {
      for (const url of d.imageUrls ?? []) {
        if (typeof url === 'string' && url.trim()) {
          const key = toImageKey(url);
          if (!exclude.has(key)) keys.add(key);
        }
      }
    }
    if (keys.size === 0) {
      this.logger.warn(`${tag} | Cây này không có ảnh đối chứng`);
      return null;
    }

    let embeddings: Map<string, Float32Array>;
    try {
      embeddings = await this.loadEmbeddings([...keys]);
    } catch (err: any) {
      this.logger.error(`${tag} | Không đọc được vector từ DB: ${err.message}`);
      return null;
    }

    // Kiểm tra độ phủ trước khi tốn một lượt gọi embedding.
    const coverage = [...keys].filter((k) => embeddings.has(k)).length / keys.size;
    const minCoverage = this.num('AI_RETRIEVAL_MIN_COVERAGE', 0.8);
    if (coverage < minCoverage) {
      this.logger.warn(
        `${tag} | Độ phủ vector ${(coverage * 100).toFixed(0)}% < ${(minCoverage * 100).toFixed(0)}% → dùng luồng dự phòng`,
      );
      return null;
    }

    let query: number[];
    try {
      query = params.queryVector ?? (await this.embedQuery(params.userImages ?? []));
    } catch (err: any) {
      const level = err instanceof EmbeddingUnavailableError ? 'warn' : 'error';
      this.logger[level](`${tag} | Không tạo được vector ảnh truy vấn: ${err.message}`);
      return null;
    }

    const { ranked } = rankDiseasesBySimilarity(params.diseases, embeddings, query, {
      topDiseases: this.num('AI_RETRIEVAL_TOP_DISEASES', 8),
      imagesPerDisease: this.num('AI_RETRIEVAL_IMAGES_PER_DISEASE', 2),
      maxImages: this.num('AI_RETRIEVAL_MAX_IMAGES', 12),
      excludeKeys: exclude,
    });
    if (ranked.length === 0) return null;

    this.logger.log(
      `${tag} | Top: ${ranked
        .slice(0, 5)
        .map((r) => `${r.disease.detail} (${r.score.toFixed(3)})`)
        .join(', ')}`,
    );
    return { mode: 'vector', coverage, diseases: ranked };
  }

  /** Dựng danh sách tham chiếu (text + ảnh) theo thứ hạng độ giống. Không có dòng "giai đoạn thường gặp". */
  async buildReferenceData(result: RetrievalResult): Promise<ReferenceData[]> {
    const size = this.num('AI_REF_IMAGE_SIZE', 384);
    const quality = this.num('AI_REF_IMAGE_QUALITY', 70);
    const concurrency = this.num('AI_IMAGE_CONCURRENCY', 3);

    const tasks = result.diseases.flatMap((rd, di) =>
      rd.images.map((img, ii) => ({ di, ii, url: img.url })),
    );
    const b64ByTask = new Map<string, string>();
    await mapConcurrent(tasks, concurrency, async (t) => {
      const b64 = await this.imageService.fetchAndOptimize(t.url, { size, quality });
      if (b64) b64ByTask.set(`${t.di}:${t.ii}`, b64);
    });

    const out: ReferenceData[] = [];
    result.diseases.forEach((rd, di) => {
      const d = rd.disease;
      const images = rd.images
        .map((_, ii) => b64ByTask.get(`${di}:${ii}`))
        .filter((b): b is string => !!b);
      const notice =
        images.length > 0
          ? ` [CÓ ${images.length} ẢNH ĐỐI CHỨNG ĐÍNH KÈM BÊN DƯỚI]`
          : ' [CHỈ THAM KHẢO MÔ TẢ TRIỆU CHỨNG VĂN BẢN]';
      const pest = d.pestDisease ? ` (${d.pestDisease})` : '';
      out.push({
        text: `[Mẫu tham chiếu #${di + 1}${notice}]\n- Bệnh: ${d.detail}${pest}\n- Triệu chứng nhận diện: ${d.description}\n- Giải pháp VFC:\n  ${d.vfcSolution}`,
        base64Image: images[0] ?? null,
      });
      images.slice(1).forEach((b64, k) => {
        out.push({
          text: `[Ảnh đối chứng ${k + 2} của Mẫu tham chiếu #${di + 1}]`,
          base64Image: b64,
        });
      });
    });
    return out;
  }

  private async embedQuery(userImages: string[]): Promise<number[]> {
    const n = this.num('AI_QUERY_IMAGES', 1);
    const sources = userImages.slice(0, n);
    if (sources.length === 0) throw new EmbeddingUnavailableError('Không có ảnh truy vấn');
    const vectors = await Promise.all(sources.map((b64) => this.embedder.embedBase64(b64)));
    return vectors.length === 1 ? vectors[0] : averageVectors(vectors);
  }

  private async loadEmbeddings(keys: string[]): Promise<Map<string, Float32Array>> {
    if (Date.now() - this.cacheLoadedAt > CACHE_TTL_MS) {
      this.cache.clear();
      this.cacheLoadedAt = Date.now();
    }
    const missing = keys.filter((k) => !this.cache.has(k));
    if (missing.length > 0) {
      const rows = await this.prisma.$queryRaw<{ image_key: string; embedding: number[] }[]>(
        Prisma.sql`SELECT image_key, embedding
                   FROM reference_image_embeddings
                   WHERE model_version = ${EMBEDDING_MODEL_VERSION}
                     AND image_key = ANY(${missing}::text[])`,
      );
      for (const r of rows) this.cache.set(r.image_key, Float32Array.from(r.embedding));
    }
    const out = new Map<string, Float32Array>();
    for (const k of keys) {
      const v = this.cache.get(k);
      if (v) out.set(k, v);
    }
    return out;
  }
}
