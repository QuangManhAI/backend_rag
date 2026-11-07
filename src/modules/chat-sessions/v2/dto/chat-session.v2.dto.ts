import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ListQueryDto } from '../../../../common/pagination/pagination';

const FILTER_MAX = 120;

export class ListSessionsV2QueryDto extends ListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @Max(50, { message: 'limit must be between 1 and 50' })
  @Min(1, { message: 'limit must be between 1 and 50' })
  @IsInt({ message: 'limit must be an integer' })
  override limit: number = 10;

  @ApiPropertyOptional({ description: 'Search keyword for session titles' })
  @IsOptional()
  @IsString({ message: 'search must be a string' })
  @MaxLength(120, { message: 'search must be at most 120 characters' })
  search?: string;

  /** Legacy alias for search */
  @ApiPropertyOptional({ description: 'Legacy alias for search' })
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

  toLegacyQuery(): {
    limit: number;
    cursor?: string;
    q?: string;
    ids?: string;
    created_at?: string;
    last_message_at?: string;
    message_count?: string;
  } {
    return {
      limit: this.limit,
      cursor: this.cursor,
      q: this.search ?? this.q,
      ids: this.ids,
      created_at: this.created_at,
      last_message_at: this.last_message_at,
      message_count: this.message_count,
    };
  }
}

