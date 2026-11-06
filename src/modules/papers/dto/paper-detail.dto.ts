import { ApiProperty } from '@nestjs/swagger';
import type {
  Chunk,
  PaperDetail,
  SectionType,
} from '../../../types/scientific-rag';

const SECTION_TYPES = [
  'abstract',
  'introduction',
  'method',
  'experiment',
  'discussion',
  'other',
];

export class ChunkDto implements Chunk {
  @ApiProperty() chunk_id: string;
  @ApiProperty() section_title: string;
  @ApiProperty({ enum: SECTION_TYPES }) section_type: SectionType;
  @ApiProperty() text: string;
}

/** Swagger shape of `GET /papers/:paper_id` (API_DESIGN §5). */
export class PaperDetailDto implements PaperDetail {
  @ApiProperty({ example: '2106.09685' }) paper_id: string;
  @ApiProperty() title: string;
  @ApiProperty({ type: [String] }) authors: string[];
  @ApiProperty({ description: 'Index in the World 3D categories.json' })
  category_index: number;
  @ApiProperty({ example: 'cs.CL' }) primary_category: string;
  @ApiProperty({ nullable: true, type: Number, example: 2021 }) year:
    number | null;
  @ApiProperty() abstract: string;
  @ApiProperty() has_fulltext: boolean;
  @ApiProperty({ type: [ChunkDto] }) chunks: Chunk[];
}

export class PaperBatchDto {
  @ApiProperty({ type: [PaperDetailDto] }) items: PaperDetailDto[];
  @ApiProperty({ type: [String] }) not_found: string[];
}
