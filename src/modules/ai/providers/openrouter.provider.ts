import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AIProvider,
  DiagnosisInput,
  DiagnosisResult,
} from '../ai-provider.interface';

@Injectable()
export class OpenRouterProvider implements AIProvider {
  readonly name = 'openrouter';
  private readonly logger = new Logger(OpenRouterProvider.name);

  constructor(private config: ConfigService) {}

  async diagnose(input: DiagnosisInput): Promise<DiagnosisResult> {
    throw new Error('Method will be implemented in Phase 1.');
  }

  async healthCheck(): Promise<boolean> {
    return !!this.config.get('OPENROUTER_API_KEY');
  }
}
