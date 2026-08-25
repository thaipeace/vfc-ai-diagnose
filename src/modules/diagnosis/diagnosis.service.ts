import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DiagnosisService {
  private readonly logger = new Logger(DiagnosisService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('diagnosis') private diagnosisQueue: Queue,
  ) {}

  /**
   * Tạo diagnosis mới + đẩy vào queue.
   */
  async create(
    userId: string,
    base64Images: string[],
    base64ImagesSmall: string[],
    cropType?: string,
  ) {
    const diagnosis = await this.prisma.plantDiagnosis.create({
      data: {
        userId,
        cropType,
        imageUrls: [],
        status: 'PROCESSING',
      },
    });

    await this.diagnosisQueue.add('process', {
      diagnosisId: diagnosis.id,
      base64Images,
      base64ImagesSmall,
      cropType,
    });

    return { id: diagnosis.id, status: 'PENDING' };
  }

  /**
   * Lấy diagnosis theo ID
   */
  async getById(id: string) {
    const diagnosis = await this.prisma.plantDiagnosis.findUnique({
      where: { id },
      include: {
        suggestions: {
          include: {
            product: true,
          },
          orderBy: { rank: 'asc' },
        },
      },
    });

    if (!diagnosis) return null;

    const raw = diagnosis.rawAiResponse as any;
    if (raw?.awaitingStage) {
      return {
        ...diagnosis,
        status: 'AWAITING_STAGE',
        awaitingStage: true,
        availableStages: raw.availableStages ?? [],
        detectedGrowthStage: raw.detectedGrowthStage ?? null,
      };
    }

    if (raw?.reasonCode === 'WRONG_CROP') {
      return {
        ...diagnosis,
        wrongCrop: true,
        plantInfo: raw.plantInfo ?? null,
      };
    }

    return diagnosis;
  }

  /**
   * Lịch sử diagnosis của user (phân trang)
   */
  async getByUser(userId: string, page: number = 1) {
    const limit = 10;
    const [total, data] = await Promise.all([
      this.prisma.plantDiagnosis.count({ where: { userId } }),
      this.prisma.plantDiagnosis.findMany({
        where: { userId },
        include: {
          suggestions: {
            include: {
              product: true,
            },
            orderBy: { rank: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { data, total, page, limit };
  }

  /**
   * Xác nhận giai đoạn sinh trưởng
   */
  async confirmStage(
    id: string,
    userId: string,
    growthStage: string,
    base64Images: string[],
  ) {
    const diagnosis = await this.prisma.plantDiagnosis.findUnique({
      where: { id },
    });

    if (!diagnosis) throw new Error('NOT_FOUND');
    if (diagnosis.userId !== userId) throw new Error('FORBIDDEN');

    const raw = diagnosis.rawAiResponse as any;

    await this.prisma.plantDiagnosis.update({
      where: { id },
      data: {
        status: 'PROCESSING',
        rawAiResponse: { processingStage: growthStage },
      },
    });

    await this.diagnosisQueue.add('process-with-stage', {
      diagnosisId: id,
      base64Images,
      cropType: diagnosis.cropType,
      growthStage,
      detectedPestDisease: raw?.detectedPestDisease,
      detectedSeverityLevel: raw?.detectedSeverityLevel,
    });

    return this.getById(id);
  }
}
