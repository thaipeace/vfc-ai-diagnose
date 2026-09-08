import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eqStr, parseJsonBlock } from '../../common/utils/string';
import {
  ImageValidationResult,
  ImageValidationReasonCode,
} from '../ai/schemas/image-validation.schema';

export interface ImageValidationInput {
  base64Images: string[];
  cropType?: string;
  allowedStages: string[];
  allowedPestDiseases: string[];
  allowedSeverityLevels: string[];
}

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

const INVALID_IMAGE_GUIDANCE: Record<
  Exclude<ImageValidationReasonCode, 'VALID'>,
  string
> = {
  NOT_A_PLANT:
    'Hệ thống không nhận diện được cây trồng trong ảnh. Vui lòng chụp rõ phần lá hoặc thân cây bị bệnh.',
  WRONG_CROP:
    'Ảnh chụp có vẻ không phải là cây trồng. Vui lòng kiểm tra lại loại cây bạn đã chọn.',
  BLURRY_IMAGE:
    'Ảnh chụp bị mờ hoặc chưa thể hiện rõ đặc điểm nhận diện của cây (như toàn bộ phiến lá, đọt non, hoa hoặc quả). Bạn vui lòng lùi camera ra một chút để lấy trọn vẹn đặc điểm cây, hoặc chụp lại ở nơi đủ ánh sáng nhé.',
};

@Injectable()
export class ImageValidatorService {
  private readonly logger = new Logger(ImageValidatorService.name);

  constructor(private config: ConfigService) {}

  buildPrompt(
    cropType: string | undefined,
    allowedStages: string[],
    allowedPestDiseases: string[],
    allowedSeverityLevels: string[],
  ): string {
    const stagesInfo =
      allowedStages.length > 0
        ? `\nDanh sách giai đoạn hợp lệ cho loại cây này: ${JSON.stringify(allowedStages)}. Hãy phát hiện giai đoạn sinh trưởng của cây trong ảnh và trả về chính xác một trong các giá trị trên vào trường "detectedGrowthStage". Nếu không xác định được, trả null.`
        : `\nKhông có danh sách giai đoạn cụ thể, trả "detectedGrowthStage": null.`;

    const pestDiseasesInfo =
      allowedPestDiseases.length > 0
        ? `\nDanh sách loại dịch hại hợp lệ: ${JSON.stringify(allowedPestDiseases)}. Hãy xác định loại dịch hại chính nhìn thấy trong ảnh và trả về chính xác một trong các giá trị trên vào trường "detectedPestDisease". Nếu không xác định được, trả null.`
        : `\nTrả "detectedPestDisease": null.`;

    const severityInfo =
      allowedSeverityLevels.length > 0
        ? `\nDanh sách mức độ bệnh hợp lệ: ${JSON.stringify(allowedSeverityLevels)}. Hãy đánh giá mức độ bệnh trong ảnh và trả về chính xác một trong các giá trị trên vào trường "detectedSeverityLevel". Nếu không xác định được, trả null.`
        : `\nTrả "detectedSeverityLevel": null.`;

    return `Bạn là một bộ lọc bảo mật và kiểm định chất lượng hình ảnh đầu vào cho ứng dụng nông nghiệp. Người dùng sẽ tải lên một bức ảnh và cho biết họ đang muốn kiểm tra cây gì (Tham số: target_crop: ${cropType || 'không có thông tin'}).
Hãy phân tích bức ảnh về mặt chi tiết vết bệnh và trả về một đối tượng JSON duy nhất theo cấu trúc nghiêm ngặt sau:
{
  "isValid": true hoặc false,
  "reasonCode": "VALID" | "NOT_A_PLANT" | "WRONG_CROP" | "BLURRY_IMAGE",
  "userGuidance": "Chuỗi tiếng Việt hướng dẫn nông dân chụp lại nếu isValid là false, hoặc chuỗi trống nếu true",
  "cropConfidence": 0.0 đến 1.0 (mức độ tin cậy khi nhận diện loại cây trong ảnh),
  "detectedGrowthStage": "tên giai đoạn hoặc null",
  "detectedPestDisease": "loại dịch hại hoặc null",
  "detectedSeverityLevel": "mức độ bệnh hoặc null",
  "plantInfo": "Chuỗi tiếng Việt mô tả ngắn gọn về cây thực tế trong ảnh (khi WRONG_CROP và cropConfidence >= 0.9), hoặc null"
}

Quy tắc đánh giá cropConfidence:
- Chỉ trả cropConfidence >= 0.9 khi nhìn thấy rõ ít nhất 2 đặc điểm nhận diện đặc trưng của cây (hình thái phiến lá đầy đủ, cấu trúc thân/nhánh, hoa, quả, hoặc đọt non).
- Nếu ảnh chỉ thấy một phần lá, chỉ có đốm bệnh, hoặc không thấy được đặc điểm nhận diện đáng tin cậy, trả cropConfidence thấp (< 0.9).

${stagesInfo}
${pestDiseasesInfo}
${severityInfo}

Nếu ảnh không chứa cây trồng, bộ phận của cây (lá, thân, rễ): isValid = false, reasonCode = "NOT_A_PLANT", userGuidance = "Hệ thống không nhận diện được cây trồng trong ảnh. Vui lòng chụp rõ phần lá hoặc thân cây bị bệnh.", cropConfidence = 0.0, detectedGrowthStage = null, plantInfo = null
Nếu ảnh là cây khác so với target_crop VÀ cropConfidence >= 0.9 (chắc chắn nhận diện được cây): isValid = false, reasonCode = "WRONG_CROP", userGuidance = "Thông tin dịch hại trên cây trồng bạn đưa không chính xác.", detectedGrowthStage = null, plantInfo = "Viết bằng tiếng Việt, ngắn gọn và thực dụng theo format sau, mỗi mục trên một dòng riêng:\\n🌿 Cây nhận diện: <tên cây tiếng Việt>\\n🔍 Tình trạng ghi nhận: <tóm tắt ngắn gọn tình trạng sức khỏe quan sát được trên lá/thân trong ảnh — khỏe mạnh, có dấu hiệu sâu bệnh, vàng lá, cháy bìa lá, v.v.>\\n💡 Hướng xử lý tiếp theo: <nếu là cây phổ biến tại VN: gợi ý chọn lại danh mục cây phù hợp để nhận phác đồ VFC; nếu cây khác: gợi ý biện pháp canh tác cơ bản và liên hệ kỹ sư nông nghiệp VFC để được tư vấn>\\nKhông bịa thông tin. Chỉ ghi những gì quan sát được từ ảnh."
Nếu ảnh là cây khác so với target_crop NHƯNG cropConfidence < 0.9 (không chắc chắn): isValid = false, reasonCode = "BLURRY_IMAGE", userGuidance = "Ảnh chụp chưa thể hiện rõ đặc điểm nhận diện của cây. Bạn vui lòng lùi camera ra một chút để lấy trọn vẹn đặc điểm cây, hoặc chụp lại ở nơi đủ ánh sáng nhé.", detectedGrowthStage = null, plantInfo = null
Nếu ảnh quá mờ, quá tối, quá sáng, chụp quá xa hoặc không thấy rõ đặc điểm nhận diện cây: isValid = false, reasonCode = "BLURRY_IMAGE", userGuidance = "Ảnh chụp bị mờ hoặc chưa thể hiện rõ đặc điểm nhận diện của cây. Bạn vui lòng lùi camera ra một chút để lấy trọn vẹn đặc điểm cây, hoặc chụp lại ở nơi đủ ánh sáng nhé.", cropConfidence = 0.0, detectedGrowthStage = null, plantInfo = null
Nếu ảnh hợp lệ và phù hợp với target_crop: isValid = true, reasonCode = "VALID", userGuidance = "", plantInfo = null`;
  }

  parseResult(
    text: string,
    cropType: string | undefined,
    allowedStages: string[],
    allowedPestDiseases: string[],
    allowedSeverityLevels: string[],
  ): ImageValidationResult {
    const parsed = parseJsonBlock(text) as Partial<
      ImageValidationResult & {
        detectedGrowthStage?: string | null;
        detectedPestDisease?: string | null;
        detectedSeverityLevel?: string | null;
        cropConfidence?: number | null;
      }
    >;

    if (typeof parsed.isValid !== 'boolean') {
      throw new Error('Image validation returned invalid isValid value');
    }
    if (
      parsed.reasonCode !== 'VALID' &&
      parsed.reasonCode !== 'NOT_A_PLANT' &&
      parsed.reasonCode !== 'WRONG_CROP' &&
      parsed.reasonCode !== 'BLURRY_IMAGE'
    ) {
      throw new Error('Image validation returned invalid reasonCode value');
    }
    if (typeof parsed.userGuidance !== 'string') {
      throw new Error('Image validation returned invalid userGuidance value');
    }
    if (parsed.isValid && parsed.reasonCode !== 'VALID') {
      throw new Error(
        'Image validation returned inconsistent isValid and reasonCode',
      );
    }
    if (!parsed.isValid && parsed.reasonCode === 'VALID') {
      throw new Error(
        'Image validation returned inconsistent invalid VALID response',
      );
    }

    // Validate detectedGrowthStage
    let detectedGrowthStage: string | null = null;
    if (parsed.isValid && parsed.detectedGrowthStage) {
      const matched = allowedStages.find((s) =>
        eqStr(s, parsed.detectedGrowthStage),
      );
      if (matched) {
        detectedGrowthStage = matched;
      } else {
        this.logger.warn(
          `detectedGrowthStage "${parsed.detectedGrowthStage}" not found in allowedStages: ${JSON.stringify(allowedStages)}`,
        );
      }
    }

    // Validate detectedPestDisease
    let detectedPestDisease: string | null = null;
    if (parsed.isValid && parsed.detectedPestDisease) {
      const matched = allowedPestDiseases.find((s) =>
        eqStr(s, parsed.detectedPestDisease),
      );
      if (matched) {
        detectedPestDisease = matched;
      } else {
        this.logger.warn(
          `detectedPestDisease "${parsed.detectedPestDisease}" not found in allowedPestDiseases: ${JSON.stringify(allowedPestDiseases)}`,
        );
      }
    }

    // Validate detectedSeverityLevel
    let detectedSeverityLevel: string | null = null;
    if (parsed.isValid && parsed.detectedSeverityLevel) {
      const matched = allowedSeverityLevels.find((s) =>
        eqStr(s, parsed.detectedSeverityLevel),
      );
      if (matched) {
        detectedSeverityLevel = matched;
      } else {
        this.logger.warn(
          `detectedSeverityLevel "${parsed.detectedSeverityLevel}" not found in allowedSeverityLevels: ${JSON.stringify(allowedSeverityLevels)}`,
        );
      }
    }

    if (parsed.isValid) {
      return {
        isValid: true,
        reasonCode: 'VALID',
        userGuidance: '',
        detectedGrowthStage,
        detectedPestDisease,
        detectedSeverityLevel,
        plantInfo: null,
      };
    }

    // Safety net: WRONG_CROP nhưng không đủ tin cậy → chuyển thành BLURRY_IMAGE
    if (parsed.reasonCode === 'WRONG_CROP') {
      const confidence =
        typeof parsed.cropConfidence === 'number' ? parsed.cropConfidence : 0;
      if (confidence < 0.9 || !parsed.plantInfo?.trim()) {
        this.logger.warn(
          `WRONG_CROP with low confidence (${confidence}) or missing plantInfo — fallback to BLURRY_IMAGE`,
        );
        return {
          isValid: false,
          reasonCode: 'BLURRY_IMAGE',
          userGuidance: INVALID_IMAGE_GUIDANCE.BLURRY_IMAGE,
          detectedGrowthStage: null,
          detectedPestDisease: null,
          detectedSeverityLevel: null,
          plantInfo: null,
        };
      }
    }

    const fallbackGuidance =
      parsed.reasonCode === 'WRONG_CROP'
        ? INVALID_IMAGE_GUIDANCE.WRONG_CROP.replace(
            'cây trồng',
            cropType || 'cây trồng',
          )
        : parsed.reasonCode === 'NOT_A_PLANT'
          ? INVALID_IMAGE_GUIDANCE.NOT_A_PLANT
          : INVALID_IMAGE_GUIDANCE.BLURRY_IMAGE;

    // Extract plantInfo for WRONG_CROP — AI trả mô tả ngắn gọn cây thực tế
    const plantInfo =
      parsed.reasonCode === 'WRONG_CROP' && typeof parsed.plantInfo === 'string'
        ? parsed.plantInfo.trim() || null
        : null;

    return {
      isValid: false,
      reasonCode: parsed.reasonCode,
      userGuidance: parsed.userGuidance.trim() || fallbackGuidance,
      detectedGrowthStage: null,
      detectedPestDisease: null,
      detectedSeverityLevel: null,
      plantInfo,
    };
  }

  async validate(input: ImageValidationInput): Promise<ImageValidationResult> {
    const apiKey =
      this.config.get<string>('OPENROUTER_API_VALIDATION_KEY') ||
      this.config.get<string>('OPENROUTER_API_KEY');

    if (!apiKey) {
      throw new Error(
        'OPENROUTER_API_VALIDATION_KEY is not defined in environment variables',
      );
    }

    const content: OpenAIContentPart[] = [
      {
        type: 'text',
        text: this.buildPrompt(
          input.cropType,
          input.allowedStages,
          input.allowedPestDiseases,
          input.allowedSeverityLevels,
        ),
      },
    ];

    for (const base64Data of input.base64Images) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:image/jpeg;base64,${base64Data}` },
      });
    }

    const model =
      this.config.get<string>('OPENROUTER_VISION_MODEL') ||
      'google/gemini-2.5-flash';

    this.logger.log(`Calling OpenRouter Vision validation API (${model})...`);

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
        temperature: 0.1,
        max_tokens: 512,
      }),
    });

    const responseText = await res.text();
    const data = JSON.parse(responseText || '{}');

    if (!res.ok) {
      throw new Error(
        `OpenRouter validation failed with HTTP ${res.status}: ${JSON.stringify(data)}`,
      );
    }

    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || text.length === 0) {
      throw new Error('OpenRouter validation returned an empty response');
    }

    return this.parseResult(
      text,
      input.cropType,
      input.allowedStages,
      input.allowedPestDiseases,
      input.allowedSeverityLevels,
    );
  }
}
