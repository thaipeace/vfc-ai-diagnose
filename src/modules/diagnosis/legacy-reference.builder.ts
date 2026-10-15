import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImageService } from '../image/image.service';
import { ReferenceData } from '../ai/ai-provider.interface';
import { AggregatedDisease } from '../../common/utils/disease-aggregator';
import {
  selectDiverseImages,
  mapConcurrent,
} from '../../common/utils/reference-sampler';

/**
 * Luồng chọn tham chiếu cũ (Diversity Sampling theo thứ tự bệnh) — dùng làm dự phòng khi retrieval
 * theo vector không chạy được. Tách ra hàm riêng để worker và script đánh giá dùng chung đúng một logic.
 */
export async function buildLegacyReferenceData(
  aggregatedDiseases: AggregatedDisease[],
  deps: {
    imageService: ImageService;
    config: ConfigService;
    logger?: Logger;
    diagnosisId?: string;
  },
): Promise<ReferenceData[]> {
  const { imageService, config, logger, diagnosisId } = deps;

  const maxRecords =
    Number(
      config.get('AI_MAX_REFERENCE_RECORDS') ??
        config.get('maxReferenceRecords') ??
        40,
    ) || 40;
  const maxImages =
    Number(
      config.get('AI_MAX_REFERENCE_IMAGES') ??
        config.get('maxReferenceImages') ??
        8,
    ) || 8;
  const concurrency =
    Number(
      config.get('AI_IMAGE_CONCURRENCY') ??
        config.get('imageConcurrency') ??
        3,
    ) || 3;

  const targetDiseases =
    aggregatedDiseases.length > maxRecords
      ? aggregatedDiseases.slice(0, maxRecords)
      : aggregatedDiseases;

  // Chọn các mẫu ảnh đại diện bằng Diversity Sampling (Round-Robin)
  const recordsToFetchImages = selectDiverseImages(targetDiseases, maxImages);

  logger?.log(
    `[Diversity Sampling] Diagnosis: ${diagnosisId ?? 'n/a'} | Selected ${recordsToFetchImages.length}/${targetDiseases.length} diverse reference images`,
  );

  // Tải và resize ảnh song song có kiểm soát concurrency (mặc định 3 luồng)
  const imageMap = new Map<string, string>();
  await mapConcurrent(recordsToFetchImages, concurrency, async (record) => {
    if (record.imageUrls && record.imageUrls.length > 0) {
      const b64 = await imageService.fetchAndOptimize(record.imageUrls[0]);
      if (b64) {
        imageMap.set(record.id, b64);
      }
    }
  });

  // Cấu trúc referenceData sạch sẽ, tinh gọn (~3.500 tokens)
  return targetDiseases.map((d, index) => {
    const b64 = imageMap.get(d.id) || null;
    const hasImgNotice = b64
      ? ' [CÓ ẢNH ĐỐI CHỨNG ĐÍNH KÈM BÊN DƯỚI]'
      : ' [CHỈ THAM KHẢO MÔ TẢ TRIỆU CHỨNG VĂN BẢN]';
    const pestNotice = d.pestDisease ? ` (${d.pestDisease})` : '';
    const stagesNotice =
      d.stagesCovered && d.stagesCovered.length > 0
        ? `\n- Giai đoạn thường gặp: ${d.stagesCovered.join(', ')}`
        : '';
    const text = `[Mẫu tham chiếu #${index + 1}${hasImgNotice}]\n- Bệnh: ${d.detail}${pestNotice}${stagesNotice}\n- Triệu chứng nhận diện: ${d.description}\n- Giải pháp VFC:\n  ${d.vfcSolution}`;
    return { text, base64Image: b64 };
  });
}
