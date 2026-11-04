import { Module } from '@nestjs/common';
import { CorpusModule } from '../corpus/corpus.module';
import { TreeRouterService } from './tree-router.service';

@Module({
  imports: [CorpusModule],
  providers: [TreeRouterService],
  exports: [TreeRouterService],
})
export class TreeRouterModule {}
