import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { ApiRootController } from './api-root/api-root.controller';
import { AuthModule } from './auth/auth.module';
import { ChatSessionsModule } from './chat-sessions/chat-sessions.module';
import { LoggerModule } from './common/logger.module';
import { THROTTLER_NAME } from './common/throttler';
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
    // Rate limiting (prompt_security S1.1). A single throttler named `default` covers every
    // route; the sensitive ones narrow their own limit with `@RateLimit(...)`.
    ThrottlerModule.forRoot([
      { name: THROTTLER_NAME, ttl: 60_000, limit: 120 },
    ]),
    AuthModule,
    AdminModule,
    RagModule,
    ChatSessionsModule,
    PapersModule,
    HealthModule,
  ],
  controllers: [ApiRootController],
  providers: [
    // The guard is registered globally so every route is rate limited, including the ones
    // added later without anyone remembering to attach a decorator.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
