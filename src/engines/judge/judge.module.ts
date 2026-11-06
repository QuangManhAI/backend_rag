import { Module } from '@nestjs/common';
import { JUDGE_PORT, JudgeService } from './judge.service';

@Module({
  providers: [JudgeService, { provide: JUDGE_PORT, useExisting: JudgeService }],
  exports: [JUDGE_PORT],
})
export class JudgeModule {}
