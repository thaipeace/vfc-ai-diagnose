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
@UseGuards(InternalAuthGuard, SecurityThrottlerGuard)
@ApiHeader({
  name: 'x-user-id',
  required: true,
  description: 'Authenticated user ID forwarded by BFF',
})
export class DiagnosisController {
  constructor(private diagnosisService: DiagnosisService) {}

  @Post()
  @HttpCode(202)
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

  @Get(':id')
  @ApiOperation({
    summary: 'Get diagnosis detail by ID (used for polling and viewing)',
  })
  async getById(@UserId() userId: string, @Param('id') id: string) {
    return this.diagnosisService.getById(id);
  }

  @Get()
  @ApiOperation({ summary: 'List diagnoses history for current user' })
  async list(@UserId() userId: string, @Query('page') page: number = 1) {
    return this.diagnosisService.getByUser(userId, Number(page) || 1);
  }

  @Patch(':id')
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
