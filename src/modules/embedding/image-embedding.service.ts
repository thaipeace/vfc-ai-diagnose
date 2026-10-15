import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
} from './embedding.constants';

/** Embedding tạm thời không dùng được (hết quota, lỗi mạng...). Người gọi nên quay về luồng cũ. */
export class EmbeddingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingUnavailableError';
  }
}

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
/** Khi gặp 429 (hết quota) thì ngừng gọi một lúc để các ca sau quay về luồng cũ ngay, không chờ timeout. */
const QUOTA_COOLDOWN_MS = 5 * 60_000;

@Injectable()
export class ImageEmbeddingService {
  private readonly logger = new Logger(ImageEmbeddingService.name);
  private disabledUntil = 0;

  constructor(private config: ConfigService) {}

  /** Vector hóa ảnh truy vấn (base64 JPEG/PNG). Ném EmbeddingUnavailableError nếu không thực hiện được. */
  async embedBase64(base64: string): Promise<number[]> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) throw new EmbeddingUnavailableError('Thiếu GEMINI_API_KEY');

    if (Date.now() < this.disabledUntil) {
      throw new EmbeddingUnavailableError('Embedding đang tạm ngưng do hết quota');
    }

    // Cùng cách xử lý với lúc backfill ảnh kho: cạnh dài ≤ 640px, JPEG q80.
    const jpeg = await sharp(Buffer.from(base64, 'base64'))
      .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    const body = JSON.stringify({
      content: {
        parts: [{ inlineData: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } }],
      },
      outputDimensionality: EMBEDDING_DIMENSIONS,
    });

    let lastError = 'unknown';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          },
        );

        if (res.ok) {
          const json: any = await res.json();
          const values: number[] | undefined = json?.embedding?.values;
          if (!Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
            throw new EmbeddingUnavailableError('Phản hồi embedding không hợp lệ');
          }
          return values;
        }

        if (res.status === 429) {
          this.disabledUntil = Date.now() + QUOTA_COOLDOWN_MS;
          this.logger.warn(
            `Embedding bị giới hạn quota (429). Tạm ngưng ${QUOTA_COOLDOWN_MS / 60_000} phút, các ca chẩn đoán sẽ dùng luồng dự phòng.`,
          );
          throw new EmbeddingUnavailableError('Hết quota embedding (429)');
        }

        lastError = `HTTP ${res.status}`;
        if (res.status < 500) break; // lỗi phía client, thử lại vô ích
      } catch (err: any) {
        if (err instanceof EmbeddingUnavailableError) throw err;
        lastError = err?.message ?? String(err);
      }
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 500 * 3 ** (attempt - 1)));
      }
    }
    throw new EmbeddingUnavailableError(`Gọi embedding thất bại: ${lastError}`);
  }
}
