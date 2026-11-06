import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  GroundedChunk,
  Quality,
  Timings,
} from '../../types/scientific-rag';

export class TimingsDto implements Timings {
  @ApiProperty({ example: 35 }) embed_ms: number;
  @ApiProperty({ example: 2 }) route_ms: number;
  @ApiProperty({ example: 18 }) search_ms: number;
  @ApiProperty({ example: 1 }) rerank_ms: number;
  @ApiProperty({ example: 1600 }) llm_ms: number;
  @ApiPropertyOptional({ example: 900 }) refine_ms?: number;
  @ApiPropertyOptional({ example: 700 }) grounded_ms?: number;
  @ApiProperty({ example: 1660 }) total_ms: number;
}

export class QualityDto implements Quality {
  @ApiProperty({ nullable: true, type: Number, example: 0.66 })
  evidence_score: number | null;

  @ApiProperty({ nullable: true, type: String })
  refined_query: string | null;

  @ApiProperty({ nullable: true, type: Number, example: 0.81 })
  grounded_score: number | null;

  @ApiProperty() abstained: boolean;
}

/** Body of `POST /rag/chat` (API_DESIGN §3). */
export class ChatResponseDto {
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'null without JWT',
  })
  session_id: string | null;

  @ApiProperty({ nullable: true, type: String })
  message_id: string | null;

  @ApiProperty() query: string;
  @ApiProperty() answer: string;
  @ApiProperty({ type: [String] }) citations: string[];

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  grounded_chunks: GroundedChunk[];

  @ApiProperty({ type: [String] }) expanded_terms: string[];

  @ApiProperty({ type: () => TimingsDto })
  timings: Timings;

  @ApiPropertyOptional({
    type: () => QualityDto,
    description: 'Absent when the judge did not run',
  })
  quality?: Quality;
}
