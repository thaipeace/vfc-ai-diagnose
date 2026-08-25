import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AIProvider,
  DiagnosisInput,
  DiagnosisResult,
} from '../ai-provider.interface';
import { parseJsonBlock } from '../../../common/utils/string';
import { DiagnosisResultSchema } from '../schemas/diagnosis-result.schema';

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

@Injectable()
export class OpenRouterProvider implements AIProvider {
  readonly name = 'openrouter';
  private readonly logger = new Logger(OpenRouterProvider.name);

  constructor(private config: ConfigService) {}

  async diagnose(input: DiagnosisInput): Promise<DiagnosisResult> {
    const apiKey = this.config.get<string>('OPENROUTER_API_KEY');
    if (!apiKey) {
      throw new Error(
        'OPENROUTER_API_KEY is not defined in environment variables',
      );
    }

    const content: OpenAIContentPart[] = [
      { type: 'text', text: 'Ảnh cây trồng của nông dân:' },
    ];

    for (const b64 of input.userImages) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${b64}` },
      });
    }

    content.push({ type: 'text', text: '\n\nDữ liệu bệnh tham khảo của VFC:' });
    for (const ref of input.referenceData) {
      content.push({ type: 'text', text: '\n' + ref.text });
      if (ref.base64Image) {
        content.push({
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${ref.base64Image}` },
        });
      }
    }

    content.push({ type: 'text', text: `\n\n${input.promptText}` });

    const model =
      this.config.get<string>('OPENROUTER_MODEL') || 'google/gemini-2.5-flash';

    this.logger.log(`Sending diagnosis request to OpenRouter (${model})...`);

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://vfc.vn',
        'X-Title': 'VFC Farmer Portal',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content }],
        temperature: 0.2,
        max_tokens: 1024,
      }),
    });

    const responseText = await res.text();
    const data = JSON.parse(responseText || '{}');
    if (!res.ok) {
      throw new Error(
        `OpenRouter API failed with ${res.status}: ${JSON.stringify(data)}`,
      );
    }

    const text = data?.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error('OpenRouter API returned an empty response');
    }

    this.logger.log(
      `OpenRouter response received. Text length: ${text.length}`,
    );

    const parsed = parseJsonBlock(text);
    const validated = DiagnosisResultSchema.parse(parsed);

    return {
      ...validated,
      provider: 'openrouter',
    };
  }

  async healthCheck(): Promise<boolean> {
    return !!this.config.get<string>('OPENROUTER_API_KEY');
  }
}
