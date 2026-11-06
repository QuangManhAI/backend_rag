import { Module } from '@nestjs/common';
import { EMBEDDING_PORT, EmbeddingService } from './embedding.service';

@Module({
  providers: [
    EmbeddingService,
    { provide: EMBEDDING_PORT, useExisting: EmbeddingService },
  ],
  exports: [EMBEDDING_PORT],
})
export class EmbeddingModule {}
