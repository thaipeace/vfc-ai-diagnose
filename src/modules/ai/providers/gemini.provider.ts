import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AIProvider,
  DiagnosisInput,
  DiagnosisResult,
} from '../ai-provider.interface';

@Injectable()
export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  private readonly logger = new Logger(GeminiProvider.name);

  constructor(private config: ConfigService) {}

  async diagnose(input: DiagnosisInput): Promise<DiagnosisResult> {
    throw new Error('Method will be implemented in Phase 1.');
  }

  async healthCheck(): Promise<boolean> {
    return !!this.config.get('GEMINI_API_KEY');
  }
}
