import { Module } from '@nestjs/common';
import { ImageModule } from '../image/image.module';
import { ImageEmbeddingService } from './image-embedding.service';
import { ReferenceRetrievalService } from './reference-retrieval.service';

@Module({
  imports: [ImageModule],
  providers: [ImageEmbeddingService, ReferenceRetrievalService],
  exports: [ImageEmbeddingService, ReferenceRetrievalService],
})
export class EmbeddingModule {}
