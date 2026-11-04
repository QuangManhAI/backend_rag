import { Module } from '@nestjs/common';
import { CorpusModule } from '../corpus/corpus.module';
import { MiningService } from './mining.service';

@Module({
  imports: [CorpusModule],
  providers: [MiningService],
  exports: [MiningService],
})
export class MiningModule {}
