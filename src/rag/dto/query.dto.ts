import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class QueryDto {
  @ApiProperty({
    description: 'The natural language scientific query or research question.',
    example: 'How does LoRA optimize large models?',
  })
  @IsString()
  @IsNotEmpty()
  query!: string;

  @ApiPropertyOptional({
    description: 'Number of top grounded scientific chunks to retrieve and utilize for synthesis.',
    minimum: 1,
    maximum: 20,
    default: 5,
    example: 3,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  top_k: number = 5;

  @ApiPropertyOptional({
    description: 'Optional category filter based on arXiv taxonomy (e.g., cs.CV, cs.LG, cs.CL, stat.ML).',
    example: 'cs.LG',
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    description: 'Whether to boost chunk ranking using author co-authorship PageRank authority scores (85% similarity, 15% authority).',
    default: true,
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  use_authority_boost: boolean = true;

  @ApiPropertyOptional({
    description: 'Whether to expand the user query using FP-Growth association rules mined from the scientific corpus.',
    default: false,
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  expand_query: boolean = false;
}
