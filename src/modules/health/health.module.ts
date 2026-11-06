import { Module } from '@nestjs/common';
import { LlmModule } from '../../engines/llm/llm.module';
import { TreeRouterModule } from '../../engines/tree-router/tree-router.module';
import { VectorStoreModule } from '../../engines/vector-store/vector-store.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [VectorStoreModule, LlmModule, TreeRouterModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
