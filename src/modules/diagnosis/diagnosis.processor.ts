import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiagnosisStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ImageService } from '../image/image.service';
import { ImageValidatorService } from '../image/image-validator.service';
import { AIEngineService } from '../ai/ai-engine.service';
import {
  AIRouterService,
  NEED_CLEARER_IMAGE_MESSAGE,
  NeedsClearerImageError,
} from '../ai/ai-router.service';
import { getCropOptionByType } from '../../config/crop-options';
import { includesStr } from '../../common/utils/string';
import { matchProductAdvanced } from '../../common/utils/product-matcher';
import { ReferenceData } from '../ai/ai-provider.interface';
import { aggregateDiseases, AggregatedDisease } from '../../common/utils/disease-aggregator';
import { ReferenceRetrievalService } from '../embedding/reference-retrieval.service';
import { buildLegacyReferenceData } from './legacy-reference.builder';

@Processor('diagnosis')
export class DiagnosisProcessor extends WorkerHost {
  private readonly logger = new Logger(DiagnosisProcessor.name);

  constructor(
    private prisma: PrismaService,
    private imageService: ImageService,
    private imageValidator: ImageValidatorService,
    private aiEngine: AIEngineService,
    private aiRouter: AIRouterService,
    private config: ConfigService,
    private retrieval: ReferenceRetrievalService,
    @InjectQueue('google-drive-sync') private driveQueue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const {
      diagnosisId,
      base64Images,
      base64ImagesSmall,
      cropType,
      growthStage,
      detectedPestDisease,
      detectedSeverityLevel,
    } = job.data;

    this.logger.log(
      `[BullMQ Worker] Processing job ${job.id} (${job.name}) for diagnosis: ${diagnosisId}`,
    );

    // Lấy cấu hình các giai đoạn chuẩn để hỗ trợ AI nhận diện
    const cropOption = await getCropOptionByType(cropType, this.prisma);
    const allowedStages = cropOption?.growthStages ?? [];
    const allowedPestDiseases = cropOption?.pestDiseases ?? [];
    const allowedSeverityLevels = cropOption?.severityLevels ?? [];

    // ─── Case 1: Stage confirmed job (hỗ trợ legacy/re-try nếu có) ───────────
    if (job.name === 'process-with-stage' || growthStage) {
      await this.runDiagnosisPipeline(
        diagnosisId,
        base64Images,
        cropType,
        allowedStages,
        growthStage,
        detectedPestDisease,
        detectedSeverityLevel,
      );
      return;
    }

    // ─── Case 2: New submission with image validation ─────────────────────────
    try {
      this.logger.log(
        `[Validation Start] Diagnosis: ${diagnosisId} | Crop: ${cropType}`,
      );

      const validationResult = await this.imageValidator.validate({
        base64Images:
          base64ImagesSmall && base64ImagesSmall.length > 0
            ? base64ImagesSmall
            : base64Images,
        cropType,
        allowedStages,
        allowedPestDiseases,
        allowedSeverityLevels,
      });

      if (!validationResult.isValid) {
        if (validationResult.reasonCode === 'WRONG_CROP') {
          const wrongCropSummary = validationResult.plantInfo
            ? `Thông tin dịch hại trên cây trồng bạn đưa không chính xác. Đây là một số thông tin hữu ích về cây này:\n${validationResult.plantInfo}\n\nĐể được hỗ trợ hiệu quả từ VFC xin cung cấp thông tin và hình ảnh chính xác.`
            : validationResult.userGuidance;

          await this.prisma.plantDiagnosis.update({
            where: { id: diagnosisId },
            data: {
              rawAiResponse: validationResult as unknown as Prisma.JsonObject,
              summary: wrongCropSummary,
              status: DiagnosisStatus.DONE,
            },
          });

          this.logger.log(
            `[Validation WRONG_CROP] Diagnosis: ${diagnosisId}`,
          );
          return;
        }

        // NOT_A_PLANT, BLURRY_IMAGE
        await this.prisma.plantDiagnosis.update({
          where: { id: diagnosisId },
          data: {
            rawAiResponse: validationResult as unknown as Prisma.JsonObject,
            summary: validationResult.userGuidance,
            status: DiagnosisStatus.FAILED,
          },
        });

        this.logger.log(
          `[Validation FAILED] Diagnosis: ${diagnosisId} | Reason: ${validationResult.reasonCode}`,
        );
        return;
      }

      // ─── Chạy THẲNG vào pipeline chẩn đoán (1-step Instant Diagnosis) ────────
      // KHÔNG dừng lại bắt nông dân chọn stage nữa. AI sẽ tự chẩn đoán bệnh & nhận diện stage.
      await this.runDiagnosisPipeline(
        diagnosisId,
        base64Images,
        cropType,
        allowedStages,
        validationResult.detectedGrowthStage ?? undefined,
        validationResult.detectedPestDisease ?? undefined,
        validationResult.detectedSeverityLevel ?? undefined,
      );
    } catch (err: any) {
      this.logger.error(
        `[Validation Error] Diagnosis: ${diagnosisId}: ${err.message}`,
        err.stack,
      );
      await this.prisma.plantDiagnosis.update({
        where: { id: diagnosisId },
        data: { status: DiagnosisStatus.FAILED },
      });
      throw err;
    }
  }

  /** Luồng chọn tham chiếu cũ (Diversity Sampling theo thứ tự bệnh) — dùng làm dự phòng. */
  private buildLegacyReferenceData(
    diagnosisId: string,
    aggregatedDiseases: AggregatedDisease[],
  ): Promise<ReferenceData[]> {
    return buildLegacyReferenceData(aggregatedDiseases, {
      imageService: this.imageService,
      config: this.config,
      logger: this.logger,
      diagnosisId,
    });
  }

  private async runDiagnosisPipeline(
    diagnosisId: string,
    base64Images: string[],
    cropType?: string,
    allowedStages: string[] = [],
    growthStage?: string,
    pestDisease?: string,
    severityLevel?: string,
  ): Promise<void> {
    this.logger.log(
      `[AI Diagnosis Start] Diagnosis: ${diagnosisId} | Crop: ${cropType} | Advisory Stage: ${growthStage ?? 'any'}`,
    );

    try {
      const allProducts = await this.prisma.product.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
      });

      // 1. Query toàn bộ bệnh của loại cây này (KHÔNG lọc cứng theo growthStage / severityLevel trong SQL)
      const rawDiseases = await this.prisma.planStageDisease.findMany({
        where: {
          cropType: cropType
            ? { equals: cropType, mode: 'insensitive' }
            : undefined,
        },
      });

      this.logger.log(
        `[Reference Data] Diagnosis: ${diagnosisId} | Found ${rawDiseases.length} total records for crop: ${cropType}`,
      );

      // 2. Gom nhóm theo thực thể bệnh duy nhất & khử trùng lặp giải pháp VFC (In-Memory Aggregator)
      const aggregatedDiseases = aggregateDiseases(rawDiseases, growthStage);

      this.logger.log(
        `[Disease Aggregator] Diagnosis: ${diagnosisId} | Aggregated into ${aggregatedDiseases.length} unique diseases`,
      );

      // 3. Chọn ảnh/bệnh đối chứng: ưu tiên truy xuất theo độ giống thị giác (vector embedding);
      //    nếu tắt hoặc không thực hiện được thì dùng luồng cũ (Diversity Sampling).
      let referenceData: ReferenceData[];
      let retrievalTrace: Record<string, unknown> | undefined;

      const vectorResult = this.retrieval.isEnabled()
        ? await this.retrieval.retrieve({
            diseases: aggregatedDiseases,
            userImages: base64Images,
            diagnosisId,
          })
        : null;

      if (vectorResult) {
        referenceData = await this.retrieval.buildReferenceData(vectorResult);
        retrievalTrace = {
          mode: 'vector',
          coverage: Number(vectorResult.coverage.toFixed(3)),
          diseases: vectorResult.diseases.map((r) => ({
            name: r.disease.detail,
            score: Number(r.score.toFixed(4)),
            images: r.images.length,
          })),
        };
        this.logger.log(
          `[Vector Retrieval] Diagnosis: ${diagnosisId} | Sent ${vectorResult.diseases.length} diseases, ${referenceData.filter((r) => r.base64Image).length} reference images`,
        );
      } else {
        referenceData = await this.buildLegacyReferenceData(
          diagnosisId,
          aggregatedDiseases,
        );
        if (this.retrieval.isEnabled()) {
          retrievalTrace = { mode: 'legacy-fallback' };
        }
      }

      const promptText = this.aiEngine.buildPrompt(cropType, allowedStages);

      const parsed = await this.aiRouter.diagnoseWithFallback({
        userImages: base64Images,
        referenceData,
        cropType,
        promptText,
      });

      // Match products
      const validProductIds: string[] = [];
      const reasonsMap: Record<string, string> = {};

      const extractedProducts =
        parsed.solutionSets?.flatMap((s) => s.products) ||
        parsed.suggestedProducts ||
        [];

      for (const pName of extractedProducts) {
        const product = matchProductAdvanced(pName, allProducts);
        if (product && !validProductIds.includes(product.id)) {
          validProductIds.push(product.id);
          reasonsMap[product.id] =
            parsed.reasons?.[pName] ||
            `Phù hợp với triệu chứng: ${parsed.disease}`;
        }
      }

      // Save result to DB (lưu growthStage do AI nhận diện vào rawAiResponse để phục vụ Admin & Client)
      await this.prisma.diagnosisSuggestion.deleteMany({
        where: { diagnosisId },
      });

      const finalAiResponse = {
        ...parsed,
        growthStage: parsed.growthStage || growthStage || null,
        ...(retrievalTrace ? { referenceRetrieval: retrievalTrace } : {}),
      };

      await this.prisma.plantDiagnosis.update({
        where: { id: diagnosisId },
        data: {
          rawAiResponse: finalAiResponse as unknown as Prisma.JsonObject,
          summary: parsed.summary,
          confidence: parsed.confidence,
          status: DiagnosisStatus.DONE,
          suggestions: {
            create: validProductIds.map((pid, i) => ({
              productId: pid,
              reason: reasonsMap[pid] || '',
              rank: i + 1,
            })),
          },
        },
      });

      this.logger.log(
        `[AI Diagnosis Complete] Diagnosis: ${diagnosisId} | Disease: ${parsed.disease} | Stage: ${parsed.growthStage || 'N/A'} | Suggestions: ${validProductIds.length}`,
      );

      // ─── Đồng bộ ca bệnh có vấn đề lên Google Drive (100% Async Non-blocking) ──
      const isNoSolution = validProductIds.length === 0;
      const isLowConfidence =
        typeof parsed.confidence === 'number' && parsed.confidence < 0.6;

      if (
        (isNoSolution || isLowConfidence) &&
        base64Images &&
        base64Images.length > 0
      ) {
        const caseType = isNoSolution ? 'NO_SOLUTION' : 'LOW_CONFIDENCE';
        this.logger.log(
          `[Google Drive Trigger] Enqueuing background sync for diagnosis: ${diagnosisId} | Case: ${caseType}`,
        );

        this.driveQueue
          .add(
            'upload-problematic-case',
            {
              diagnosisId,
              cropType,
              growthStage: finalAiResponse.growthStage || undefined,
              disease: parsed.disease || 'Chưa xác định',
              confidence: parsed.confidence,
              caseType,
              summary: parsed.summary,
              base64Image: base64Images[0],
            },
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 5000 },
            },
          )
          .catch((err) => {
            this.logger.error(
              `[Google Drive Trigger] Failed to enqueue drive sync job for ${diagnosisId}: ${err.message}`,
            );
          });
      }
    } catch (err: any) {
      this.logger.error(
        `[AI Diagnosis Error] Diagnosis: ${diagnosisId}: ${err.message}`,
        err.stack,
      );
      const needsClearerImage = err instanceof NeedsClearerImageError;
      await this.prisma.plantDiagnosis.update({
        where: { id: diagnosisId },
        data: {
          rawAiResponse: needsClearerImage
            ? { reasonCode: 'DIAGNOSIS_TIMEOUT' }
            : undefined,
          summary: needsClearerImage ? NEED_CLEARER_IMAGE_MESSAGE : undefined,
          status: DiagnosisStatus.FAILED,
        },
      });
      throw err;
    }
  }
}
