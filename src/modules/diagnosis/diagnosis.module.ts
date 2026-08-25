import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DiagnosisController } from './diagnosis.controller';
import { DiagnosisService } from './diagnosis.service';
import { DiagnosisProcessor } from './diagnosis.processor';
import { ImageModule } from '../image/image.module';
import { AIModule } from '../ai/ai.module';

@Module({
  imports: [
    ImageModule,
    AIModule,
    BullModule.registerQueue({
      name: 'diagnosis',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: {
          age: 86400,
          count: 1000,
        },
        removeOnFail: {
          age: 604800,
        },
      },
    }),
  ],
  controllers: [DiagnosisController],
  providers: [DiagnosisService, DiagnosisProcessor],
  exports: [DiagnosisService],
})
export class DiagnosisModule {}
