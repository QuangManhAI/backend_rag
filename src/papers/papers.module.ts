import { Module } from '@nestjs/common';
import { CorpusModule } from '../corpus/corpus.module';
import { TreeRouterModule } from '../tree-router/tree-router.module';
import { VectorStoreModule } from '../vector-store/vector-store.module';
import { PapersController } from './papers.controller';
import { PapersService } from './papers.service';

@Module({
  imports: [VectorStoreModule, TreeRouterModule, CorpusModule],
  controllers: [PapersController],
  providers: [PapersService],
})
export class PapersModule {}
