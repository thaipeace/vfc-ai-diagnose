import { toImageKey } from './image-key';

export type Vec = ArrayLike<number>;

export function cosineSimilarity(a: Vec, b: Vec): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function normalizeVector(v: Vec): number[] {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(v, (x) => x / norm);
}

/** Trung bình các vector rồi chuẩn hóa (gộp nhiều ảnh của cùng một ca). */
export function averageVectors(vectors: Vec[]): number[] {
  if (vectors.length === 0) throw new Error('averageVectors: không có vector');
  const dim = vectors[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) sum[i] += v[i];
  }
  return normalizeVector(sum);
}

export interface RankableDisease {
  diseaseKey: string;
  imageUrls: string[];
}

export interface RankedImage {
  url: string;
  key: string;
  sim: number;
}

export interface RankedDisease<T extends RankableDisease> {
  disease: T;
  /** Độ tương đồng cao nhất trong các ảnh của bệnh. */
  score: number;
  images: RankedImage[];
}

export interface RankOptions {
  topDiseases: number;
  imagesPerDisease: number;
  maxImages: number;
  /** Khóa ảnh cần loại khỏi kết quả (dùng khi đánh giá leave-one-out). */
  excludeKeys?: Set<string>;
}

export interface RankResult<T extends RankableDisease> {
  ranked: RankedDisease<T>[];
  /** Số ảnh duy nhất (sau khi loại excludeKeys) của cây này. */
  totalImages: number;
  /** Trong đó số ảnh đã có vector. */
  embeddedImages: number;
}

/**
 * Xếp hạng bệnh theo ảnh giống nhất với ảnh truy vấn.
 * - Mỗi bệnh được chấm bằng ảnh giống nhất của nó (max-sim).
 * - Lấy `topDiseases` bệnh đầu; mỗi bệnh tối đa `imagesPerDisease` ảnh (đa dạng, không để một bệnh chiếm hết).
 * - Tổng ảnh không vượt `maxImages`: vòng 1 cấp ảnh tốt nhất cho từng bệnh theo thứ hạng,
 *   các vòng sau mới cấp ảnh thứ hai, thứ ba...
 */
export function rankDiseasesBySimilarity<T extends RankableDisease>(
  diseases: T[],
  embeddings: Map<string, Vec>,
  query: Vec,
  opts: RankOptions,
): RankResult<T> {
  const exclude = opts.excludeKeys ?? new Set<string>();
  const allKeys = new Set<string>();
  const embeddedKeys = new Set<string>();
  const scored: RankedDisease<T>[] = [];

  for (const disease of diseases) {
    const seen = new Set<string>();
    const images: RankedImage[] = [];

    for (const url of disease.imageUrls ?? []) {
      if (typeof url !== 'string' || !url.trim()) continue;
      const key = toImageKey(url);
      if (exclude.has(key) || seen.has(key)) continue;
      seen.add(key);
      allKeys.add(key);

      const vec = embeddings.get(key);
      if (!vec) continue;
      embeddedKeys.add(key);
      images.push({ url, key, sim: cosineSimilarity(query, vec) });
    }

    if (images.length === 0) continue;
    images.sort((a, b) => b.sim - a.sim);
    scored.push({ disease, score: images[0].sim, images });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score || a.disease.diseaseKey.localeCompare(b.disease.diseaseKey),
  );

  const top = scored.slice(0, Math.max(1, opts.topDiseases));
  const picked = top.map((r) => ({ ...r, images: [] as RankedImage[] }));

  let total = 0;
  for (let round = 0; round < Math.max(1, opts.imagesPerDisease); round++) {
    for (let i = 0; i < top.length; i++) {
      if (total >= opts.maxImages) break;
      const img = top[i].images[round];
      if (img) {
        picked[i].images.push(img);
        total++;
      }
    }
  }

  return {
    ranked: picked,
    totalImages: allKeys.size,
    embeddedImages: embeddedKeys.size,
  };
}
