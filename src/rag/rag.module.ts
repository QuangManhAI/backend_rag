import { Module } from '@nestjs/common';
import { ChatSessionsModule } from '../chat-sessions/chat-sessions.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { JudgeModule } from '../judge/judge.module';
import { LlmModule } from '../llm/llm.module';
import { MiningModule } from '../mining/mining.module';
import { TreeRouterModule } from '../tree-router/tree-router.module';
import { VectorStoreModule } from '../vector-store/vector-store.module';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';

@Module({
  imports: [
    EmbeddingModule,
    JudgeModule,
    VectorStoreModule,
    MiningModule,
    TreeRouterModule,
    LlmModule,
    ChatSessionsModule,
  ],
  controllers: [RagController],
  providers: [RagService],
})
export class RagModule {}
