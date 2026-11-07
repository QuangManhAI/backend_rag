import { Module } from '@nestjs/common';
import { LlmModule } from '../../engines/llm/llm.module';
import { TreeRouterModule } from '../../engines/tree-router/tree-router.module';
import { VectorStoreModule } from '../../engines/vector-store/vector-store.module';
import { HealthController } from './health.controller';
import { HealthV2Controller } from './v2/health.v2.controller';
import { HealthService } from './health.service';

@Module({
  imports: [VectorStoreModule, LlmModule, TreeRouterModule],
  controllers: [HealthController, HealthV2Controller],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
