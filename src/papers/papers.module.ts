import { Module } from '@nestjs/common';
import { PapersController } from './papers.controller';
import { VectorStoreModule } from '../vector-store/vector-store.module';
import { WorldModule } from '../world/world.module';

@Module({
  imports: [VectorStoreModule, WorldModule],
  controllers: [PapersController],
})
export class PapersModule {}
