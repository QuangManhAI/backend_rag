import { Module } from '@nestjs/common';
import { TreeRouterModule } from '../tree-router/tree-router.module';
import { VectorStoreModule } from '../vector-store/vector-store.module';
import { PapersController } from './papers.controller';
import { PapersService } from './papers.service';

@Module({
  imports: [VectorStoreModule, TreeRouterModule],
  controllers: [PapersController],
  providers: [PapersService],
})
export class PapersModule {}
