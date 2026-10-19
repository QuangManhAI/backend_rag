import { Module } from '@nestjs/common';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';
import { EmbeddingModule } from '../embedding/embedding.module';
import { VectorStoreModule } from '../vector-store/vector-store.module';
import { MiningModule } from '../mining/mining.module';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [EmbeddingModule, VectorStoreModule, MiningModule, LlmModule],
  controllers: [RagController],
  providers: [RagService],
  exports: [RagService],
})
export class RagModule {}
