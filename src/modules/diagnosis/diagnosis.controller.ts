import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Query,
  Body,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { DiagnosisService } from './diagnosis.service';
import {
  CreateDiagnosisDto,
  ConfirmStageDto,
} from './dto/create-diagnosis.dto';
import { InternalAuthGuard } from '../../common/guards/internal-auth.guard';
import { SecurityThrottlerGuard } from '../../common/security/security-throttler.guard';
import { UserId } from '../../common/decorators/user-id.decorator';

@ApiTags('diagnoses')
@Controller('diagnoses')
@UseGuards(InternalAuthGuard) // Xác thực JWT/x-user-id cho toàn bộ controller
@ApiHeader({
  name: 'x-user-id',
  required: true,
  description: 'Authenticated user ID forwarded by BFF',
})
export class DiagnosisController {
  constructor(private diagnosisService: DiagnosisService) {}

  /**
   * Tạo chẩn đoán mới ➔ Kích hoạt gọi AI ➔ CẦN BẢO VỆ RATE LIMIT
   */
  @Post()
  @HttpCode(202)
  @UseGuards(SecurityThrottlerGuard) // 👈 Chỉ gắn Guard bảo vệ tại đây!
  @ApiOperation({ summary: 'Submit images for AI plant diagnosis' })
  async create(
    @UserId() userId: string,
    @Body() dto: CreateDiagnosisDto,
  ) {
    return this.diagnosisService.create(
      userId,
      dto.base64Images,
      dto.base64ImagesSmall,
      dto.cropType,
    );
  }

  /**
   * Polling kiểm tra kết quả (Frontend gọi 2s/lần) ➔ KHÔNG ĐƯỢC CHẶN RATE LIMIT
   */
  @Get(':id')
  @ApiOperation({
    summary: 'Get diagnosis detail by ID (used for polling and viewing)',
  })
  async getById(@UserId() userId: string, @Param('id') id: string) {
    return this.diagnosisService.getById(id);
  }

  /**
   * Xem danh sách lịch sử chẩn đoán ➔ KHÔNG ĐƯỢC CHẶN RATE LIMIT
   */
  @Get()
  @ApiOperation({ summary: 'List diagnoses history for current user' })
  async list(@UserId() userId: string, @Query('page') page: number = 1) {
    return this.diagnosisService.getByUser(userId, Number(page) || 1);
  }

  /**
   * Xác nhận giai đoạn sinh trưởng ➔ Kích hoạt gọi AI tiếp ➔ CẦN BẢO VỆ RATE LIMIT
   */
  @Patch(':id')
  @UseGuards(SecurityThrottlerGuard) // 👈 Gắn Guard bảo vệ tại đây
  @ApiOperation({ summary: 'Confirm growth stage to continue diagnosis' })
  async confirmStage(
    @UserId() userId: string,
    @Param('id') id: string,
    @Body() dto: ConfirmStageDto,
  ) {
    return this.diagnosisService.confirmStage(
      id,
      userId,
      dto.growthStage,
      dto.base64Images,
    );
  }
}
