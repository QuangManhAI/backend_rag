import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ListQueryDto } from '../../common/pagination';
import { TimingsDto } from '../../rag/dto/chat-response.dto';
import type { GroundedChunk, Timings } from '../../types/scientific-rag';

const FILTER_MAX = 120;

export class ListSessionsQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @Max(50, { message: 'limit must be between 1 and 50' })
  @Min(1, { message: 'limit must be between 1 and 50' })
  @IsInt({ message: 'limit must be an integer' })
  override limit: number = 10;

  @ApiPropertyOptional({ description: 'Case-insensitive search in titles' })
  @IsOptional()
  @IsString({ message: 'q must be a string' })
  @MaxLength(120, { message: 'q must be at most 120 characters' })
  q?: string;

  @ApiPropertyOptional({
    description: 'Batch read: comma-separated session ids (at most 50)',
  })
  @IsOptional()
  @IsString({ message: 'invalid ids' })
  @MaxLength(4096, { message: 'invalid ids' })
  ids?: string;

  @ApiPropertyOptional({ example: 'gte:2026-01-01,lt:2026-02-01' })
  @IsOptional()
  @IsString({ message: 'invalid filter: created_at' })
  @MaxLength(FILTER_MAX, { message: 'invalid filter: created_at' })
  created_at?: string;

  @ApiPropertyOptional({ example: 'gte:2026-01-01' })
  @IsOptional()
  @IsString({ message: 'invalid filter: last_message_at' })
  @MaxLength(FILTER_MAX, { message: 'invalid filter: last_message_at' })
  last_message_at?: string;

  @ApiPropertyOptional({ example: 'gt:2,lte:20' })
  @IsOptional()
  @IsString({ message: 'invalid filter: message_count' })
  @MaxLength(FILTER_MAX, { message: 'invalid filter: message_count' })
  message_count?: string;
}

export class ListMessagesQueryDto extends ListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @Max(100, { message: 'limit must be between 1 and 100' })
  @Min(1, { message: 'limit must be between 1 and 100' })
  @IsInt({ message: 'limit must be an integer' })
  override limit: number = 50;
}

export class RenameSessionDto {
  @ApiProperty({ minLength: 1, maxLength: 120 })
  @IsString({ message: 'invalid title' })
  title: string;
}

export class SessionSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() message_count: number;
  @ApiProperty() last_message_at: string;
  @ApiProperty() created_at: string;
  @ApiProperty() updated_at: string;
}

export class MessageDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ['user', 'assistant'] }) role: 'user' | 'assistant';
  @ApiProperty() content: string;
  @ApiPropertyOptional({ type: [String] }) citations?: string[];
  @ApiPropertyOptional({ type: 'array', items: { type: 'object' } })
  grounded_chunks?: GroundedChunk[];
  @ApiPropertyOptional({ type: () => TimingsDto }) timings?: Timings;
  @ApiProperty() created_at: string;
  @ApiProperty() updated_at: string;
}

export class SessionDto {
  @ApiProperty() id: string;
  @ApiProperty() title: string;
  @ApiProperty() message_count: number;
  @ApiProperty() last_message_at: string;
  @ApiProperty() created_at: string;
  @ApiProperty() updated_at: string;
  @ApiProperty({ type: [MessageDto] }) messages: MessageDto[];
}

export class MessagePageDto {
  @ApiProperty({ type: [MessageDto] }) items: MessageDto[];
  @ApiProperty({ nullable: true, type: String }) next_cursor: string | null;
  @ApiProperty() has_more: boolean;
}

export class SessionPageDto {
  @ApiProperty({ type: [SessionSummaryDto] }) items: SessionSummaryDto[];
  @ApiProperty({ nullable: true, type: String }) next_cursor: string | null;
  @ApiProperty() has_more: boolean;
}
