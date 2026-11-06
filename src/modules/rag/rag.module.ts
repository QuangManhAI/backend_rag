import { Module } from '@nestjs/common';
import { ChatSessionsModule } from '../chat-sessions/chat-sessions.module';
import { EmbeddingModule } from '../../engines/embedding/embedding.module';
import { JudgeModule } from '../../engines/judge/judge.module';
import { LlmModule } from '../../engines/llm/llm.module';
import { MiningModule } from '../../engines/mining/mining.module';
import { TreeRouterModule } from '../../engines/tree-router/tree-router.module';
import { VectorStoreModule } from '../../engines/vector-store/vector-store.module';
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
