import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeminiProvider } from './providers/gemini.provider';
import { OpenRouterProvider } from './providers/openrouter.provider';
import {
  DiagnosisInput,
  DiagnosisResult,
} from './ai-provider.interface';

export const NEED_CLEARER_IMAGE_MESSAGE =
  'Ảnh hiện tại chưa đủ rõ để hệ thống khoanh vùng chính xác. Bạn vui lòng chụp lại ảnh rõ hơn, gần vùng bệnh hơn và đủ ánh sáng nhé.';

export class NeedsClearerImageError extends Error {
  constructor(message = NEED_CLEARER_IMAGE_MESSAGE) {
    super(message);
    this.name = 'NeedsClearerImageError';
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new NeedsClearerImageError());
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

@Injectable()
export class AIRouterService {
  private readonly logger = new Logger(AIRouterService.name);

  constructor(
    private gemini: GeminiProvider,
    private openrouter: OpenRouterProvider,
    private config: ConfigService,
  ) {}

  async diagnoseWithFallback(input: DiagnosisInput): Promise<DiagnosisResult> {
    const timeoutMs =
      this.config.get<number>('AI_TIMEOUT_MS') || 90_000;

    return withTimeout(this.executeFallback(input), timeoutMs);
  }

  private async executeFallback(
    input: DiagnosisInput,
  ): Promise<DiagnosisResult> {
    // 1st: Gemini
    try {
      this.logger.log('[AI Fallback] Trying Gemini...');
      const result = await this.gemini.diagnose(input);
      this.logger.log(
        `[AI Fallback] Gemini succeeded | Disease: ${result.disease} | SolutionSets: ${result.solutionSets?.length ?? 0}`,
      );
      return { ...result, provider: 'gemini' };
    } catch (geminiError: any) {
      this.logger.error(
        `[AI Fallback] Gemini failed, switching to OpenRouter: ${geminiError.message}`,
        geminiError.stack,
      );
    }

    // 2nd: OpenRouter
    this.logger.log('[AI Fallback] Trying OpenRouter...');
    const result = await this.openrouter.diagnose(input);
    this.logger.log(
      `[AI Fallback] OpenRouter succeeded | Disease: ${result.disease} | SolutionSets: ${result.solutionSets?.length ?? 0}`,
    );
    return { ...result, provider: 'openrouter', fallbackFrom: 'gemini' };
  }
}
