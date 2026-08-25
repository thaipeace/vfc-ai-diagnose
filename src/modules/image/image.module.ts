import { Module } from '@nestjs/common';
import { ImageService } from './image.service';
import { ImageValidatorService } from './image-validator.service';

@Module({
  providers: [ImageService, ImageValidatorService],
  exports: [ImageService, ImageValidatorService],
})
export class ImageModule {}
