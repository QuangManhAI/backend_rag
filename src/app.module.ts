import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from './auth/auth.module';
import { ChatSessionsModule } from './chat-sessions/chat-sessions.module';
import { LoggerModule } from './common/logger.module';
import { AppConfigModule, AppConfigService } from './config/app-config.service';
import { CORPUS_CONNECTION, CorpusModule } from './corpus/corpus.module';
import { HealthModule } from './health/health.module';
import { PapersModule } from './papers/papers.module';
import { RagModule } from './rag/rag.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule,
    MongooseModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        uri: config.get('MONGO_URI'),
        serverSelectionTimeoutMS: 5000,
      }),
    }),
    /**
     * The corpus lives in its own database. It holds hundreds of thousands of
     * large text documents written in bulk by the ingest jobs, which is a very
     * different access profile from the application database (users, chat
     * sessions) — keeping them apart stops the corpus ingest from distorting
     * the working set of the chat collections.
     */
    MongooseModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        uri: config.get('MONGO_CORPUS_URI') ?? config.get('MONGO_URI'),
        dbName: config.get('MONGO_CORPUS_DB'),
        serverSelectionTimeoutMS: 5000,
      }),
      connectionName: CORPUS_CONNECTION,
    }),
    AuthModule,
    RagModule,
    ChatSessionsModule,
    PapersModule,
    HealthModule,
    CorpusModule,
  ],
})
export class AppModule {}
