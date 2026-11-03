import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { UUID_RE } from '../../common/uuid';
import { CATEGORY_RE } from '../../vector-store/vector-store.service';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Body of `POST /rag/chat` and `POST /rag/chat/stream` (API_DESIGN §3 + `nprobe`). */
export class ChatRequestDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 2000,
    example: 'How does LoRA optimize large models?',
  })
  @Transform(trim)
  @MaxLength(2000, { message: 'query must be at most 2000 characters' })
  @IsString({ message: 'query must be a string' })
  @IsNotEmpty({ message: 'query should not be empty' })
  query: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 20, default: 5 })
  @IsOptional()
  @Type(() => Number)
  @Max(20, { message: 'top_k must be an integer between 1 and 20' })
  @Min(1, { message: 'top_k must be an integer between 1 and 20' })
  @IsInt({ message: 'top_k must be an integer between 1 and 20' })
  top_k: number = 5;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 6,
    default: 2,
    description: 'Branches/twigs kept per tree level',
  })
  @IsOptional()
  @Type(() => Number)
  @Max(6, { message: 'nprobe must be an integer between 1 and 6' })
  @Min(1, { message: 'nprobe must be an integer between 1 and 6' })
  @IsInt({ message: 'nprobe must be an integer between 1 and 6' })
  nprobe: number = 2;

  @ApiPropertyOptional({ example: 'cs.LG' })
  @IsOptional()
  @Matches(CATEGORY_RE, { message: 'validation error' })
  @IsString({ message: 'validation error' })
  category?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean({ message: 'use_authority_boost must be a boolean' })
  use_authority_boost: boolean = true;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean({ message: 'expand_query must be a boolean' })
  expand_query: boolean = false;

  @ApiPropertyOptional({ description: 'Continue this session (needs JWT)' })
  @IsOptional()
  @Matches(UUID_RE, { message: 'invalid session_id' })
  @IsString({ message: 'invalid session_id' })
  session_id?: string;
}
