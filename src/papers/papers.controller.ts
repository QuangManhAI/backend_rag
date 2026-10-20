import { Controller, Get, Param, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { VectorStoreService } from '../vector-store/vector-store.service';
import { WorldService } from '../world/world.service';

@ApiTags('Papers')
@Controller('api/papers')
export class PapersController {
  constructor(
    private readonly vectorStoreService: VectorStoreService,
    private readonly worldService: WorldService,
  ) {}

  @Get(':id')
  @ApiOperation({
    summary: 'Get Scientific Paper Details',
    description: 'Retrieves title, abstract, authors, and text chunks from LanceDB gold tier or procedural metadata.',
  })
  @ApiParam({ name: 'id', description: 'Paper ID (e.g. arXiv ID 2301.02419 or openalex:W...)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Paper metadata and extracted text chunks.' })
  async getPaper(@Param('id') paperId: string) {
    // 1. Query real chunks in LanceDB table
    const chunks = await this.vectorStoreService.getPaperChunks(paperId);
    if (chunks && chunks.length > 0) {
      const first = chunks[0];
      const abstractChunk = chunks.find((c) => c.section_type === 'abstract');
      return {
        paper_id: first.paper_id,
        title: first.title,
        authors: Array.isArray(first.authors) && first.authors.length > 0 ? first.authors : ['Research Author'],
        category_index: 0,
        year: 2024,
        abstract: abstractChunk ? abstractChunk.text : first.text,
        has_fulltext: chunks.length > 1,
        chunks: chunks.map((c, i) => ({
          chunk_id: c.chunk_id || `${paperId}_${i}`,
          section_title: c.section_title || 'Section',
          section_type: c.section_type || 'method',
          text: c.text,
        })),
      };
    }

    // 2. Fall back to deterministic procedural paper detail
    return this.worldService.getPaperDetail(paperId);
  }
}
