import { Module } from '@nestjs/common';
import { TreeRouterService } from './tree-router.service';

@Module({
  providers: [TreeRouterService],
  exports: [TreeRouterService],
})
export class TreeRouterModule {}
