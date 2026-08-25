import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
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
import { ReferenceData } from '../ai/ai-provider.interface';

const MAX_REFERENCE_ITEMS = 7;

@Processor('diagnosis')
export class DiagnosisProcessor extends WorkerHost {
  private readonly logger = new Logger(DiagnosisProcessor.name);

  constructor(
    private prisma: PrismaService,
    private imageService: ImageService,
    private imageValidator: ImageValidatorService,
    private aiEngine: AIEngineService,
    private aiRouter: AIRouterService,
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

    // ─── Case 1: Stage confirmed job ──────────────────────────────────────────
    if (job.name === 'process-with-stage' || growthStage) {
      await this.runDiagnosisPipeline(
        diagnosisId,
        base64Images,
        cropType,
        growthStage,
        detectedPestDisease,
        detectedSeverityLevel,
      );
      return;
    }

    // ─── Case 2: New submission with image validation ─────────────────────────
    try {
      const cropOption = await getCropOptionByType(cropType, this.prisma);
      const allowedStages = cropOption?.growthStages ?? [];
      const allowedPestDiseases = cropOption?.pestDiseases ?? [];
      const allowedSeverityLevels = cropOption?.severityLevels ?? [];

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
            status: DiagnosisStatus.DONE,
          },
        });

        this.logger.log(
          `[Validation FAILED] Diagnosis: ${diagnosisId} | Reason: ${validationResult.reasonCode}`,
        );
        return;
      }

      // Check if plant has growth stage choices
      if (allowedStages.length > 0) {
        const awaitingPayload = {
          awaitingStage: true,
          availableStages: allowedStages,
          detectedGrowthStage: validationResult.detectedGrowthStage,
          detectedPestDisease: validationResult.detectedPestDisease,
          detectedSeverityLevel: validationResult.detectedSeverityLevel,
        };

        await this.prisma.plantDiagnosis.update({
          where: { id: diagnosisId },
          data: {
            rawAiResponse: awaitingPayload,
            status: DiagnosisStatus.DONE, // Client recognizes awaitingStage in rawAiResponse
          },
        });

        this.logger.log(
          `[Validation AWAITING_STAGE] Diagnosis: ${diagnosisId} | Stages: ${allowedStages.length}`,
        );
        return;
      }

      // If no stage selection needed, run diagnosis directly
      await this.runDiagnosisPipeline(
        diagnosisId,
        base64Images,
        cropType,
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

  private async runDiagnosisPipeline(
    diagnosisId: string,
    base64Images: string[],
    cropType?: string,
    growthStage?: string,
    pestDisease?: string,
    severityLevel?: string,
  ): Promise<void> {
    this.logger.log(
      `[AI Diagnosis Start] Diagnosis: ${diagnosisId} | Crop: ${cropType} | Stage: ${growthStage ?? 'any'} | Pest: ${pestDisease ?? 'any'} | Severity: ${severityLevel ?? 'any'}`,
    );

    try {
      const allProducts = await this.prisma.product.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
      });

      // Query reference data
      const baseWhere: Prisma.PlanStageDiseaseWhereInput = {
        cropType: cropType
          ? { equals: cropType, mode: 'insensitive' }
          : undefined,
        growthStage: growthStage
          ? { equals: growthStage, mode: 'insensitive' }
          : undefined,
      };

      let relevantDiseases = await this.prisma.planStageDisease.findMany({
        where: baseWhere,
      });

      if (pestDisease) {
        const filtered = await this.prisma.planStageDisease.findMany({
          where: {
            ...baseWhere,
            pestDisease: { equals: pestDisease, mode: 'insensitive' },
          },
        });
        if (filtered.length > 0) relevantDiseases = filtered;
      }

      if (severityLevel) {
        const pestWhere = pestDisease
          ? {
              ...baseWhere,
              pestDisease: {
                equals: pestDisease,
                mode: 'insensitive' as const,
              },
            }
          : baseWhere;
        const filtered = await this.prisma.planStageDisease.findMany({
          where: {
            ...pestWhere,
            severityLevel: { equals: severityLevel, mode: 'insensitive' },
          },
        });
        if (filtered.length > 0) relevantDiseases = filtered;
      }

      this.logger.log(
        `[Reference Data] Diagnosis: ${diagnosisId} | Found ${relevantDiseases.length} matching records`,
      );

      if (relevantDiseases.length > MAX_REFERENCE_ITEMS) {
        relevantDiseases = relevantDiseases
          .sort(() => Math.random() - 0.5)
          .slice(0, MAX_REFERENCE_ITEMS);
      }

      const referenceData: ReferenceData[] = [];
      for (const d of relevantDiseases) {
        let b64: string | null = null;
        if (d.imageUrls && d.imageUrls.length > 0) {
          b64 = await this.imageService.fetchAndOptimize(d.imageUrls[0]);
        }
        const text = `- Bệnh: ${d.detail} (${d.pestDisease})\n- Mức độ: ${d.severityLevel}\n- Mô tả: ${d.description}\n- Giải pháp VFC: ${d.vfcSolution}`;
        referenceData.push({ text, base64Image: b64 });
      }

      const promptText = this.aiEngine.buildPrompt(cropType);

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
        const product = allProducts.find(
          (p) => includesStr(p.name, pName) || includesStr(pName, p.name),
        );
        if (product && !validProductIds.includes(product.id)) {
          validProductIds.push(product.id);
          reasonsMap[product.id] =
            parsed.reasons?.[pName] ||
            `Phù hợp với triệu chứng: ${parsed.disease}`;
        }
      }

      // Save result to DB
      await this.prisma.diagnosisSuggestion.deleteMany({
        where: { diagnosisId },
      });

      await this.prisma.plantDiagnosis.update({
        where: { id: diagnosisId },
        data: {
          rawAiResponse: parsed as unknown as Prisma.JsonObject,
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
        `[AI Diagnosis Complete] Diagnosis: ${diagnosisId} | Disease: ${parsed.disease} | Suggestions: ${validProductIds.length}`,
      );
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
