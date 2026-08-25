import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  AIProvider,
  DiagnosisInput,
  DiagnosisResult,
} from '../ai-provider.interface';
import { parseJsonBlock } from '../../../common/utils/string';
import { DiagnosisResultSchema } from '../schemas/diagnosis-result.schema';

type GeminiContentPart =
  | { text: string }
  | { inlineData: { data: string; mimeType: 'image/jpeg' } };

@Injectable()
export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  private readonly logger = new Logger(GeminiProvider.name);

  constructor(private config: ConfigService) {}

  async diagnose(input: DiagnosisInput): Promise<DiagnosisResult> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not defined in environment variables');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const modelName =
      this.config.get<string>('GEMINI_MODEL') || 'gemini-2.5-flash';
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: { temperature: 0.1 },
    });

    const parts: GeminiContentPart[] = [
      { text: 'Ảnh cây trồng của nông dân:' },
    ];

    for (const b64 of input.userImages) {
      parts.push({ inlineData: { data: b64, mimeType: 'image/jpeg' } });
    }

    parts.push({ text: '\n\nDữ liệu bệnh tham khảo của VFC:' });
    for (const ref of input.referenceData) {
      parts.push({ text: '\n' + ref.text });
      if (ref.base64Image) {
        parts.push({
          inlineData: { data: ref.base64Image, mimeType: 'image/jpeg' },
        });
      }
    }

    parts.push({ text: `\n\n${input.promptText}` });

    this.logger.log(`Sending diagnosis request to Gemini API (${modelName})...`);
    const result = await model.generateContent(parts);
    const text = result.response.text();
    this.logger.log(
      `Gemini response received. Text length: ${text.length}`,
    );

    const parsed = parseJsonBlock(text);
    const validated = DiagnosisResultSchema.parse(parsed);

    return {
      ...validated,
      provider: 'gemini',
    };
  }

  async healthCheck(): Promise<boolean> {
    return !!this.config.get<string>('GEMINI_API_KEY');
  }
}
