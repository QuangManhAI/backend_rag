import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RagModule } from './rag/rag.module';
import { WorldModule } from './world/world.module';
import { PapersModule } from './papers/papers.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env'],
    }),
    RagModule,
    WorldModule,
    PapersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
