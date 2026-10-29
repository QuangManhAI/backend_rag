import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from './auth/auth.module';
import { ChatSessionsModule } from './chat-sessions/chat-sessions.module';
import { LoggerModule } from './common/logger.module';
import { AppConfigModule, AppConfigService } from './config/app-config.service';
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
        maxPoolSize: 120,
        minPoolSize: 20,
        maxIdleTimeMS: 60_000,
      }),
    }),
    AuthModule,
    RagModule,
    ChatSessionsModule,
    PapersModule,
    HealthModule,
  ],
})
export class AppModule {}
