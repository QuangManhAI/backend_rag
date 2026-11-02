import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { Role } from '../types/auth-user';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const ADMIN_ROLES: Role[] = ['user', 'admin'];

export class ListAdminUsersQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @Max(50, { message: 'limit must be between 1 and 50' })
  @Min(1, { message: 'limit must be between 1 and 50' })
  @IsInt({ message: 'limit must be an integer' })
  limit: number = 20;

  @ApiPropertyOptional({ description: 'Opaque cursor from `next_cursor`' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @ApiPropertyOptional({ description: 'Search in email or display_name' })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'q must be a string' })
  @MaxLength(120, { message: 'q must be at most 120 characters' })
  q?: string;

  @ApiPropertyOptional({ enum: ADMIN_ROLES })
  @IsOptional()
  @IsIn(ADMIN_ROLES, { message: 'role must be user or admin' })
  role?: Role;

  @ApiPropertyOptional({ description: 'Filter by account state' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value;
  })
  @IsBoolean({ message: 'active must be a boolean' })
  active?: boolean;
}

export class UpdateRolesDto {
  @ApiProperty({ enum: ADMIN_ROLES, example: ['user', 'admin'] })
  @IsArray({ message: 'validation error' })
  @ArrayMinSize(1, { message: 'validation error' })
  @ArrayUnique({ message: 'validation error' })
  @IsIn(ADMIN_ROLES, { each: true, message: 'validation error' })
  roles: Role[];
}

export class DisableUserDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'reason must be a string' })
  @MaxLength(200, { message: 'reason must be at most 200 characters' })
  reason?: string;
}

export class AdminUserDto {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiProperty() display_name: string;
  @ApiProperty({ type: [String], example: ['user'] }) roles: Role[];
  @ApiProperty() is_active: boolean;
  @ApiProperty({ nullable: true, type: String }) disabled_at: string | null;
  @ApiProperty({ nullable: true, type: String }) disabled_reason: string | null;
  @ApiProperty() token_version: number;
  @ApiProperty({ nullable: true, type: String }) last_login_at: string | null;
  @ApiProperty() created_at: string;
}

export class AdminUserDetailDto extends AdminUserDto {
  @ApiProperty() session_count: number;
  @ApiProperty() message_count: number;
  @ApiProperty() active_token_count: number;
}

export class AdminUserPageDto {
  @ApiProperty({ type: [AdminUserDto] }) items: AdminUserDto[];
  @ApiProperty({ nullable: true, type: String }) next_cursor: string | null;
  @ApiProperty() has_more: boolean;
}

export class TokenFamilyDto {
  @ApiProperty() family_id: string;
  @ApiProperty() created_at: string;
  @ApiProperty() expires_at: string;
}

export class RevokeTokensResultDto {
  @ApiProperty({ example: 3 }) revoked_count: number;
}

export class ListSessionsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @Max(50, { message: 'limit must be between 1 and 50' })
  @Min(1, { message: 'limit must be between 1 and 50' })
  @IsInt({ message: 'limit must be an integer' })
  limit: number = 20;

  @ApiPropertyOptional({ description: 'Opaque cursor from `next_cursor`' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @ApiPropertyOptional({ description: 'Search in session title' })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'q must be a string' })
  @MaxLength(120, { message: 'q must be at most 120 characters' })
  q?: string;
}

export class AdminSessionDto {
  @ApiProperty() id: string;
  @ApiProperty() user_id: string;
  @ApiProperty() title: string;
  @ApiProperty() message_count: number;
  @ApiProperty() last_message_at: string;
  @ApiProperty() created_at: string;
}

export class AdminMessageDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ['user', 'assistant'] }) role: 'user' | 'assistant';
  @ApiProperty() content: string;
  @ApiProperty({ nullable: true, type: String }) created_at: string;
}

export class AdminSessionDetailDto extends AdminSessionDto {
  @ApiProperty({ type: [AdminMessageDto] }) messages: AdminMessageDto[];
}

export class AdminSessionPageDto {
  @ApiProperty({ type: [AdminSessionDto] }) items: AdminSessionDto[];
  @ApiProperty({ nullable: true, type: String }) next_cursor: string | null;
  @ApiProperty() has_more: boolean;
}

export class AdminStatsDto {
  @ApiProperty() users_total: number;
  @ApiProperty() users_active: number;
  @ApiProperty() users_disabled: number;
  @ApiProperty() admins_active: number;
  @ApiProperty() sessions_total: number;
  @ApiProperty() messages_total: number;
  @ApiProperty() uptime_s: number;
  @ApiProperty({
    example: {
      model_id: 'qwen2.5-7b',
      gpu: 'cuda',
      queue_length: 0,
      running: 0,
    },
  })
  llm: { model_id: string; gpu: string; queue_length: number; running: number };
}

export class LoginAttemptDto {
  @ApiProperty() key: string;
  @ApiProperty() created_at: string;
}

export class AuditLogDto {
  @ApiProperty() id: string;
  @ApiProperty() actor_id: string;
  @ApiProperty() actor_email: string;
  @ApiProperty() action: string;
  @ApiProperty() target_type: string;
  @ApiProperty({ nullable: true, type: String }) target_id: string | null;
  @ApiProperty({ nullable: true }) before: unknown;
  @ApiProperty({ nullable: true }) after: unknown;
  @ApiProperty({ nullable: true, type: String }) ip: string | null;
  @ApiProperty({ nullable: true, type: String }) request_id: string | null;
  @ApiProperty() created_at: string;
}

export class AuditLogPageDto {
  @ApiProperty({ type: [AuditLogDto] }) items: AuditLogDto[];
  @ApiProperty({ nullable: true, type: String }) next_cursor: string | null;
  @ApiProperty() has_more: boolean;
}

export class ListAuditLogsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @Max(50, { message: 'limit must be between 1 and 50' })
  @Min(1, { message: 'limit must be between 1 and 50' })
  @IsInt({ message: 'limit must be an integer' })
  limit: number = 20;

  @ApiPropertyOptional({ description: 'Opaque cursor from `next_cursor`' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @ApiPropertyOptional({ description: 'Filter by the admin who acted' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  actor_id?: string;

  @ApiPropertyOptional({ description: 'Filter by exact audit action' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  action?: string;
}

export class LoginAttemptsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @Max(200, { message: 'limit must be between 1 and 200' })
  @Min(1, { message: 'limit must be between 1 and 200' })
  @IsInt({ message: 'limit must be an integer' })
  limit: number = 50;
}

export class ForbiddenReasonDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @Transform(trim)
  @IsString({ message: 'reason must be a string' })
  @MinLength(1, { message: 'reason must not be empty' })
  @MaxLength(200, { message: 'reason must be at most 200 characters' })
  reason: string;
}
