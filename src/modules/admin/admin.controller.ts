import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import {
  adminSessionLinks,
  adminUserLinks,
  WithLinks,
} from '../../common/http/hateoas';
import { ListQueryDto } from '../../common/pagination/pagination';
import { HealthDto } from '../health/dto/health.dto';
import type { AuthUser } from '../../types/auth-user';
import { AdminAuditService, type AuditRequest } from './admin-audit.service';
import { AdminIdentityService } from './admin-identity.service';
import { AdminOpsService } from './admin-ops.service';
import {
  AdminMessagePageDto,
  AdminSessionDto,
  AdminSessionDetailDto,
  AdminSessionPageDto,
  AdminStatsDto,
  AdminUserDetailDto,
  AdminUserDto,
  AdminUserPageDto,
  AuditLogPageDto,
  ListAdminUsersQueryDto,
  ListAuditLogsQueryDto,
  ListSessionsQueryDto,
  LoginAttemptPageDto,
  LoginAttemptsQueryDto,
  RevokeTokensResultDto,
  TokenFamilyListDto,
  UpdateRolesDto,
  UpdateUserStatusDto,
} from './dto/admin.dto';
import { AuditContext } from './decorators/audit-context.decorator';

/**
 * The admin surface (prompt_security S4, S5, S6).
 *
 * Every route is guarded twice: `JwtAuthGuard` authenticates the caller and `RolesGuard` (through
 * `@Roles('admin')`) checks the role. The services repeat the role check as defense in depth.
 *
 * The surface is **read-mostly**: the only delete revokes a user's tokens. Content and the audit
 * trail cannot be deleted from here.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly identity: AdminIdentityService,
    private readonly ops: AdminOpsService,
    private readonly audit: AdminAuditService,
  ) {}

  // ---------------------------------------------------------------- A1 · users

  @Get('users')
  @WithLinks({ item: (u: AdminUserDto) => adminUserLinks(u) })
  @ApiOkResponse({ type: AdminUserPageDto })
  listUsers(
    @Query() q: ListAdminUsersQueryDto,
    @CurrentUser() me: AuthUser,
    @AuditContext() ctx: AuditRequest,
  ): Promise<unknown> {
    return this.identity.listUsers(me, q, ctx);
  }

  @Get('users/:id')
  @WithLinks({ resource: (u: AdminUserDto) => adminUserLinks(u) })
  @ApiOkResponse({ type: AdminUserDetailDto })
  @ApiNotFoundResponse({ description: 'user not found' })
  getUser(
    @Param('id') id: string,
    @CurrentUser() me: AuthUser,
    @AuditContext() ctx: AuditRequest,
  ): Promise<unknown> {
    return this.identity.getUser(me, id, ctx);
  }

  @Put('users/:id/roles')
  @WithLinks({ resource: (u: AdminUserDto) => adminUserLinks(u) })
  @ApiOkResponse({ type: AdminUserDto })
  @ApiNotFoundResponse({ description: 'user not found' })
  @ApiConflictResponse({ description: 'self lockout or last-admin protection' })
  changeRoles(
    @Param('id') id: string,
    @Body() dto: UpdateRolesDto,
    @CurrentUser() me: AuthUser,
    @AuditContext() ctx: AuditRequest,
  ): Promise<unknown> {
    return this.identity.changeRoles(me, id, dto.roles, ctx);
  }

  @Put('users/:id/status')
  @WithLinks({ resource: (u: AdminUserDto) => adminUserLinks(u) })
  @ApiOkResponse({ type: AdminUserDto })
  @ApiNotFoundResponse({ description: 'user not found' })
  @ApiConflictResponse({ description: 'self lockout or last-admin protection' })
  setStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() me: AuthUser,
    @AuditContext() ctx: AuditRequest,
  ): Promise<unknown> {
    return this.identity.setUserStatus(me, id, dto.active, dto.reason, ctx);
  }

  // ---------------------------------------------------------------- A6 · tokens

  @Get('users/:id/tokens')
  @WithLinks()
  @ApiOkResponse({ type: TokenFamilyListDto })
  @ApiNotFoundResponse({ description: 'user not found' })
  listUserTokens(
    @Param('id') id: string,
    @CurrentUser() me: AuthUser,
    @AuditContext() ctx: AuditRequest,
  ): Promise<unknown> {
    return this.identity.listUserTokens(me, id, ctx);
  }

  @Delete('users/:id/tokens')
  @ApiOkResponse({ type: RevokeTokensResultDto })
  @ApiNotFoundResponse({ description: 'user not found' })
  revokeTokens(
    @Param('id') id: string,
    @CurrentUser() me: AuthUser,
    @AuditContext() ctx: AuditRequest,
  ): Promise<unknown> {
    return this.identity.revokeUserTokens(me, id, ctx);
  }

  // ---------------------------------------------------------------- B1 · chat sessions

  @Get('users/:id/chat-sessions')
  @WithLinks({ item: (x: AdminSessionDto) => adminSessionLinks(x.id) })
  @ApiOkResponse({ type: AdminSessionPageDto })
  @ApiNotFoundResponse({ description: 'user not found' })
  listUserSessions(
    @Param('id') id: string,
    @Query() q: ListSessionsQueryDto,
    @CurrentUser() me: AuthUser,
    @AuditContext() ctx: AuditRequest,
  ): Promise<unknown> {
    return this.ops.listUserSessions(me, id, q, ctx);
  }

  @Get('chat-sessions/:id')
  @WithLinks({ resource: (x: AdminSessionDto) => adminSessionLinks(x.id) })
  @ApiOkResponse({ type: AdminSessionDetailDto })
  @ApiNotFoundResponse({ description: 'session not found' })
  getSession(
    @Param('id') id: string,
    @CurrentUser() me: AuthUser,
    @AuditContext() ctx: AuditRequest,
  ): Promise<unknown> {
    return this.ops.getSession(me, id, ctx);
  }

  @Get('chat-sessions/:id/messages')
  @WithLinks()
  @ApiOkResponse({ type: AdminMessagePageDto })
  @ApiNotFoundResponse({ description: 'session not found' })
  listSessionMessages(
    @Param('id') id: string,
    @Query() q: ListQueryDto,
    @CurrentUser() me: AuthUser,
    @AuditContext() ctx: AuditRequest,
  ): Promise<unknown> {
    return this.ops.listSessionMessages(me, id, q, ctx);
  }

  // ---------------------------------------------------------------- C1-C3 · ops

  @Get('stats')
  @ApiOkResponse({ type: AdminStatsDto })
  getStats(
    @CurrentUser() me: AuthUser,
    @AuditContext() ctx: AuditRequest,
  ): Promise<unknown> {
    return this.ops.getStats(me, ctx);
  }

  @Get('login-attempts')
  @WithLinks()
  @ApiOkResponse({ type: LoginAttemptPageDto })
  listLoginAttempts(
    @Query() q: LoginAttemptsQueryDto,
    @CurrentUser() me: AuthUser,
    @AuditContext() ctx: AuditRequest,
  ): Promise<unknown> {
    return this.ops.listLoginAttempts(me, q, ctx);
  }

  @Get('health')
  @ApiOkResponse({ type: HealthDto })
  getHealth(
    @CurrentUser() me: AuthUser,
    @AuditContext() ctx: AuditRequest,
  ): Promise<unknown> {
    return this.ops.getHealth(me, ctx);
  }

  // ---------------------------------------------------------------- D2 · audit log

  @Get('audit-logs')
  @WithLinks()
  @ApiOkResponse({ type: AuditLogPageDto })
  listAuditLogs(
    @Query() q: ListAuditLogsQueryDto,
    @CurrentUser() me: AuthUser,
    @AuditContext() ctx: AuditRequest,
  ): Promise<unknown> {
    return this.audit.listAuditLogs(me, q, ctx);
  }
}
