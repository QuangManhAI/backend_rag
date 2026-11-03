import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { requestIdOf } from '../common/request-context';
import type { AuthUser } from '../types/auth-user';
import { AdminAuditService } from './admin-audit.service';
import { AdminIdentityService } from './admin-identity.service';
import { AdminOpsService } from './admin-ops.service';
import {
  DisableUserDto,
  ListAdminUsersQueryDto,
  ListAuditLogsQueryDto,
  ListSessionsQueryDto,
  LoginAttemptsQueryDto,
  UpdateRolesDto,
} from './admin.dto';

/**
 * The admin surface (prompt_security S4, S5, S6).
 *
 * Every route is guarded twice: `JwtAuthGuard` authenticates the caller and `RolesGuard` (through
 * `@Roles('admin')`) checks the role. The services repeat the role check as defense in depth.
 *
 * The surface is **read-mostly**: there are no delete endpoints — the "violating content"
 * requirement only asked for visibility.
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
  @ApiOkResponse({ description: 'Paginated admin view of the user list' })
  listUsers(
    @Query() q: ListAdminUsersQueryDto,
    @CurrentUser() me: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<unknown> {
    return this.identity.listUsers(
      me,
      q.q,
      q.limit,
      q.cursor,
      q.role,
      q.active,
      { ip, id: requestIdOf(req) ?? undefined },
    );
  }

  @Get('users/:id')
  @ApiOkResponse({ description: 'Admin view of one user' })
  @ApiNotFoundResponse({ description: 'user not found' })
  getUser(
    @Param('id') id: string,
    @CurrentUser() me: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<unknown> {
    return this.identity.getUser(me, id, {
      ip,
      id: requestIdOf(req) ?? undefined,
    });
  }

  @Patch('users/:id/roles')
  @ApiOkResponse({ description: 'The user with the new roles' })
  @ApiNotFoundResponse({ description: 'user not found' })
  @ApiConflictResponse({ description: 'self lockout or last-admin protection' })
  changeRoles(
    @Param('id') id: string,
    @Body() dto: UpdateRolesDto,
    @CurrentUser() me: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<unknown> {
    return this.identity.changeRoles(me, id, dto.roles, {
      ip,
      id: requestIdOf(req) ?? undefined,
    });
  }

  @Post('users/:id/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'The locked user' })
  @ApiNotFoundResponse({ description: 'user not found' })
  @ApiConflictResponse({ description: 'self lockout or last-admin protection' })
  disableUser(
    @Param('id') id: string,
    @Body() dto: DisableUserDto,
    @CurrentUser() me: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<unknown> {
    return this.identity.disableUser(me, id, dto.reason, {
      ip,
      id: requestIdOf(req) ?? undefined,
    });
  }

  @Post('users/:id/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'The re-enabled user' })
  @ApiNotFoundResponse({ description: 'user not found' })
  enableUser(
    @Param('id') id: string,
    @CurrentUser() me: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<unknown> {
    return this.identity.enableUser(me, id, {
      ip,
      id: requestIdOf(req) ?? undefined,
    });
  }

  // ---------------------------------------------------------------- A6 · tokens

  @Post('users/:id/revoke-tokens')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: 'How many refresh tokens were revoked' })
  @ApiNotFoundResponse({ description: 'user not found' })
  revokeTokens(
    @Param('id') id: string,
    @CurrentUser() me: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<unknown> {
    return this.identity.revokeUserTokens(me, id, {
      ip,
      id: requestIdOf(req) ?? undefined,
    });
  }

  @Get('users/:id/tokens')
  @ApiOkResponse({ description: 'Active refresh-token families of the user' })
  @ApiNotFoundResponse({ description: 'user not found' })
  listUserTokens(
    @Param('id') id: string,
    @CurrentUser() me: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<unknown> {
    return this.identity.listUserTokens(me, id, {
      ip,
      id: requestIdOf(req) ?? undefined,
    });
  }

  // ---------------------------------------------------------------- B1 · sessions

  @Get('users/:id/sessions')
  @ApiOkResponse({ description: 'Paginated chat sessions of the user' })
  @ApiNotFoundResponse({ description: 'user not found' })
  listUserSessions(
    @Param('id') id: string,
    @Query() q: ListSessionsQueryDto,
    @CurrentUser() me: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<unknown> {
    return this.ops.listUserSessions(me, id, q.q, q.limit, q.cursor, {
      ip,
      id: requestIdOf(req) ?? undefined,
    });
  }

  @Get('sessions/:sessionId')
  @ApiOkResponse({ description: 'One session with its messages' })
  @ApiNotFoundResponse({ description: 'session not found' })
  getSession(
    @Param('sessionId') sessionId: string,
    @CurrentUser() me: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<unknown> {
    return this.ops.getSession(me, sessionId, {
      ip,
      id: requestIdOf(req) ?? undefined,
    });
  }

  // ---------------------------------------------------------------- C1-C3 · ops

  @Get('stats')
  @ApiOkResponse({ description: 'Global system statistics' })
  getStats(
    @CurrentUser() me: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<unknown> {
    return this.ops.getStats(me, { ip, id: requestIdOf(req) ?? undefined });
  }

  @Get('login-attempts')
  @ApiOkResponse({ description: 'Recent failed-login records' })
  listLoginAttempts(
    @Query() q: LoginAttemptsQueryDto,
    @CurrentUser() me: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<unknown> {
    return this.ops.listLoginAttempts(me, q.limit, {
      ip,
      id: requestIdOf(req) ?? undefined,
    });
  }

  @Get('health')
  @ApiOkResponse({ description: 'Detailed health check of every component' })
  getHealth(
    @CurrentUser() me: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<unknown> {
    return this.ops.getHealth(me, { ip, id: requestIdOf(req) ?? undefined });
  }

  // ---------------------------------------------------------------- D2 · audit log

  @Get('audit-logs')
  @ApiOkResponse({ description: 'Paginated audit trail' })
  listAuditLogs(
    @Query() q: ListAuditLogsQueryDto,
    @CurrentUser() me: AuthUser,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<unknown> {
    return this.audit.listAuditLogs(
      me,
      q.limit,
      q.cursor,
      q.actor_id,
      q.action,
      { ip, id: requestIdOf(req) ?? undefined },
    );
  }
}
