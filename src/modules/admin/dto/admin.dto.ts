import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ListQueryDto } from '../../../common/pagination/pagination';
import type { Role } from '../../../types/auth-user';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const ADMIN_ROLES: Role[] = ['user', 'admin'];

const filterMessage = (name: string) => ({
  message: `invalid filter: ${name}`,
});

export class ListAdminUsersQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ description: 'Search in email or display_name' })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'q must be a string' })
  @MaxLength(120, { message: 'q must be at most 120 characters' })
  q?: string;

  @ApiPropertyOptional({ example: 'eq:admin', description: 'user or admin' })
  @IsOptional()
  @IsString(filterMessage('role'))
  @MaxLength(32, filterMessage('role'))
  role?: string;

  @ApiPropertyOptional({ example: 'eq:true' })
  @IsOptional()
  @IsString(filterMessage('is_active'))
  @MaxLength(32, filterMessage('is_active'))
  is_active?: string;

  @ApiPropertyOptional({ example: 'match:lisa' })
  @IsOptional()
  @IsString(filterMessage('email'))
  @MaxLength(260, filterMessage('email'))
  email?: string;

  @ApiPropertyOptional({ example: 'gte:2026-01-01,lt:2026-02-01' })
  @IsOptional()
  @IsString(filterMessage('created_at'))
  @MaxLength(120, filterMessage('created_at'))
  created_at?: string;
}

export class UpdateRolesDto {
  @ApiProperty({ enum: ADMIN_ROLES, example: ['user', 'admin'] })
  @IsArray({ message: 'validation error' })
  @ArrayMinSize(1, { message: 'validation error' })
  @ArrayUnique({ message: 'validation error' })
  @IsIn(ADMIN_ROLES, { each: true, message: 'validation error' })
  roles: Role[];
}

/** Full state of the account's lock: repeating the same request changes nothing. */
export class UpdateUserStatusDto {
  @ApiProperty({ description: 'false locks the account, true unlocks it' })
  @IsBoolean({ message: 'active must be a boolean' })
  active: boolean;

  @ApiPropertyOptional({ maxLength: 200, description: 'Only when locking' })
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

export class TokenFamilyListDto {
  @ApiProperty({ type: [TokenFamilyDto] }) items: TokenFamilyDto[];
}

export class RevokeTokensResultDto {
  @ApiProperty({ example: 3 }) revoked_count: number;
}

export class ListSessionsQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ description: 'Search in session title' })
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'q must be a string' })
  @MaxLength(120, { message: 'q must be at most 120 characters' })
  q?: string;

  @ApiPropertyOptional({ example: 'gte:2026-01-01' })
  @IsOptional()
  @IsString(filterMessage('created_at'))
  @MaxLength(120, filterMessage('created_at'))
  created_at?: string;
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

export class AdminMessagePageDto {
  @ApiProperty({ type: [AdminMessageDto] }) items: AdminMessageDto[];
  @ApiProperty({ nullable: true, type: String }) next_cursor: string | null;
  @ApiProperty() has_more: boolean;
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

export class LoginAttemptPageDto {
  @ApiProperty({ type: [LoginAttemptDto] }) items: LoginAttemptDto[];
  @ApiProperty({ nullable: true, type: String }) next_cursor: string | null;
  @ApiProperty() has_more: boolean;
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

export class ListAuditLogsQueryDto extends ListQueryDto {
  @ApiPropertyOptional({
    description: 'The admin who acted',
    example: 'eq:64b0',
  })
  @IsOptional()
  @IsString(filterMessage('actor_id'))
  @MaxLength(64, filterMessage('actor_id'))
  actor_id?: string;

  @ApiPropertyOptional({ example: 'eq:USER_DISABLE' })
  @IsOptional()
  @IsString(filterMessage('action'))
  @MaxLength(64, filterMessage('action'))
  action?: string;

  @ApiPropertyOptional({ example: 'eq:user' })
  @IsOptional()
  @IsString(filterMessage('target_type'))
  @MaxLength(32, filterMessage('target_type'))
  target_type?: string;

  @ApiPropertyOptional({ example: 'gte:2026-01-01,lt:2026-02-01' })
  @IsOptional()
  @IsString(filterMessage('created_at'))
  @MaxLength(120, filterMessage('created_at'))
  created_at?: string;
}

export class LoginAttemptsQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ example: 'gte:2026-01-01' })
  @IsOptional()
  @IsString(filterMessage('created_at'))
  @MaxLength(120, filterMessage('created_at'))
  created_at?: string;
}
