import { Module } from '@nestjs/common';
import { MiningService } from './mining.service';

@Module({
  providers: [MiningService],
  exports: [MiningService],
})
export class MiningModule {}
