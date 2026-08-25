import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Processor('diagnosis')
export class DiagnosisProcessor extends WorkerHost {
  private readonly logger = new Logger(DiagnosisProcessor.name);

  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job): Promise<void> {
    const { diagnosisId } = job.data;
    this.logger.log(`🔄 Processing job ${job.id} for diagnosis: ${diagnosisId}`);
    // Core AI diagnosis pipeline will be implemented in Phase 1
  }
}
