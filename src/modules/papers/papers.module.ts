import { Module } from '@nestjs/common';
import { TreeRouterModule } from '../../engines/tree-router/tree-router.module';
import { VectorStoreModule } from '../../engines/vector-store/vector-store.module';
import { PapersController } from './papers.controller';
import { PapersV2Controller } from './v2/papers.v2.controller';
import { PapersService } from './papers.service';

@Module({
  imports: [VectorStoreModule, TreeRouterModule],
  controllers: [PapersController, PapersV2Controller],
  providers: [PapersService],
})
export class PapersModule {}
