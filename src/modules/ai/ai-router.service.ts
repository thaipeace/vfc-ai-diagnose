import { Injectable, Logger } from '@nestjs/common';
import { GeminiProvider } from './providers/gemini.provider';
import { OpenRouterProvider } from './providers/openrouter.provider';
import {
  AIProvider,
  DiagnosisInput,
  DiagnosisResult,
} from './ai-provider.interface';

@Injectable()
export class AIRouterService {
  private readonly logger = new Logger(AIRouterService.name);

  constructor(
    private gemini: GeminiProvider,
    private openrouter: OpenRouterProvider,
  ) {}

  async diagnoseWithFallback(input: DiagnosisInput): Promise<DiagnosisResult> {
    const providers: AIProvider[] = [this.gemini, this.openrouter];

    for (const provider of providers) {
      try {
        this.logger.log(`Đang thử provider: ${provider.name}`);
        const result = await provider.diagnose(input);
        this.logger.log(`✅ ${provider.name} thành công`);
        return { ...result, provider: provider.name };
      } catch (error) {
        this.logger.warn(
          `❌ ${provider.name} thất bại, thử provider tiếp theo...`,
        );
      }
    }

    throw new Error('Tất cả AI providers đều thất bại');
  }
}
