import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MiningService } from './mining.service';

@Module({
  imports: [ConfigModule],
  providers: [MiningService],
  exports: [MiningService],
})
export class MiningModule {}
