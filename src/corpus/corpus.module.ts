import { Module } from '@nestjs/common';
import { CORPUS_PORT, CorpusService } from './corpus.service';

@Module({
  providers: [
    CorpusService,
    { provide: CORPUS_PORT, useExisting: CorpusService },
  ],
  exports: [CORPUS_PORT],
})
export class CorpusModule {}
