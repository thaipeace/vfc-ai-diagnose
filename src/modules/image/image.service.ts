import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';

@Injectable()
export class ImageService {
  private readonly logger = new Logger(ImageService.name);

  /**
   * Tải ảnh tham khảo từ URL (Google Drive, Cloud...) + resize nhỏ lại (256x256, q=60) để gửi cho AI.
   */
  async fetchAndOptimize(rawUrl: string): Promise<string | null> {
    try {
      let url = rawUrl
        .trim()
        .replace(/^\{|\}$|^\[|\]$/g, '')
        .replace(/^"|"$/g, '')
        .replace(/^'|'$/g, '')
        .trim();

      // Chuyển đổi Google Drive share/view links → direct download link
      if (url.includes('drive.google.com')) {
        const fileMatch = url.match(/\/file\/d\/([^/?\s]+)/);
        if (fileMatch) {
          url = `https://lh3.googleusercontent.com/d/${fileMatch[1]}`;
        } else {
          const ucMatch = url.match(/[?&]id=([^&\s]+)/);
          if (ucMatch) {
            url = `https://lh3.googleusercontent.com/d/${ucMatch[1]}`;
          }
        }
      }

      const res = await fetch(url);
      if (!res.ok) {
        this.logger.warn(`Failed to fetch image HTTP ${res.status}: ${url}`);
        return null;
      }

      const arrayBuffer = await res.arrayBuffer();
      const buffer = await sharp(Buffer.from(arrayBuffer))
        .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 60 })
        .toBuffer();

      return buffer.toString('base64');
    } catch (err) {
      this.logger.error(`Failed to fetch/optimize ref image: ${rawUrl}`, err);
      return null;
    }
  }
}
