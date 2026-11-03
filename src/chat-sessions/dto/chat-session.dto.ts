import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { TimingsDto } from '../../rag/dto/chat-response.dto';
import type { GroundedChunk, Timings } from '../../types/scientific-rag';

export class ListSessionsQueryDto {
  @ApiPropertyOptional({ description: 'Opaque cursor from `next_cursor`' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive search in titles' })
  @IsOptional()
  @IsString({ message: 'q must be a string' })
  @MaxLength(120, { message: 'q must be at most 120 characters' })
  q?: string;
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

export class SessionPageDto {
  @ApiProperty({ type: [SessionSummaryDto] }) items: SessionSummaryDto[];
  @ApiProperty({ nullable: true, type: String }) next_cursor: string | null;
  @ApiProperty() has_more: boolean;
}
