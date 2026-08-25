import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class AIEngineService {
  private readonly logger = new Logger(AIEngineService.name);

  buildPrompt(cropType?: string): string {
    return `Chẩn đoán bệnh cho cây ${cropType || 'trồng'}`;
  }
}
