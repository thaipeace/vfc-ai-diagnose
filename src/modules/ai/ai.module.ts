import { Module } from '@nestjs/common';
import { GeminiProvider } from './providers/gemini.provider';
import { OpenRouterProvider } from './providers/openrouter.provider';
import { AIEngineService } from './ai-engine.service';
import { AIRouterService } from './ai-router.service';

@Module({
  providers: [
    GeminiProvider,
    OpenRouterProvider,
    AIEngineService,
    AIRouterService,
  ],
  exports: [
    GeminiProvider,
    OpenRouterProvider,
    AIEngineService,
    AIRouterService,
  ],
})
export class AIModule {}
