import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDiagnosisDto {
  @ApiProperty({ description: 'Array of base64 encoded images (512x512)' })
  base64Images!: string[];

  @ApiProperty({ description: 'Array of small base64 encoded images (256x256) for quick validation' })
  base64ImagesSmall!: string[];

  @ApiPropertyOptional({ description: 'Crop type name (e.g. Lúa)' })
  cropType?: string;
}

export class ConfirmStageDto {
  @ApiProperty({ description: 'Selected growth stage' })
  growthStage!: string;

  @ApiProperty({ description: 'Array of base64 images' })
  base64Images!: string[];
}
