import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatSessionsModule } from '../chat-sessions/chat-sessions.module';
import { HealthModule } from '../health/health.module';
import { LlmModule } from '../../engines/llm/llm.module';
import { AdminAuditService } from './admin-audit.service';
import { AdminController } from './admin.controller';
import { AdminV2Controller } from './v2/admin.v2.controller';
import { AdminIdentityService } from './admin-identity.service';
import { AdminOpsService } from './admin-ops.service';
import {
  AdminAuditLog,
  AdminAuditLogSchema,
} from './schemas/admin-audit-log.schema';

/**
 * The admin module (prompt_security S4).
 *
 * It is split into three services by concern so each one stays testable in isolation:
 *  - `AdminAuditService` — the append-only trail;
 *  - `AdminIdentityService` — users, roles, locks, tokens (A1–A4, A6, E1);
 *  - `AdminOpsService` — sessions, statistics, login attempts, health (B1, B1b, C1–C3).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AdminAuditLog.name, schema: AdminAuditLogSchema },
    ]),
    ChatSessionsModule,
    HealthModule,
    LlmModule,
  ],
  controllers: [AdminController, AdminV2Controller],
  providers: [AdminAuditService, AdminIdentityService, AdminOpsService],
})
export class AdminModule {}
