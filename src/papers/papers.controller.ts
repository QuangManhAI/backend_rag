import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { paperLinks, WithLinks } from '../common/hateoas';
import { BatchIdsQueryDto, parseIds } from '../common/pagination';
import { RateLimit } from '../common/throttler';
import type { PaperDetail } from '../types/scientific-rag';
import { PaperBatchDto, PaperDetailDto } from './paper-detail.dto';
import { PAPER_BATCH_MAX, PapersService } from './papers.service';

@ApiTags('Papers')
@Controller('papers')
export class PapersController {
  constructor(private readonly papers: PapersService) {}

  /** Batch read of at most 20 papers. There is no unfiltered listing: `ids` is required. */
  @Get()
  @WithLinks({ item: (p: PaperDetail) => paperLinks(p.paper_id) })
  @RateLimit('papersBatch')
  @ApiOkResponse({ type: PaperBatchDto })
  @ApiServiceUnavailableResponse({ description: 'qdrant unavailable' })
  @ApiTooManyRequestsResponse({ description: 'too many requests' })
  getMany(@Query() q: BatchIdsQueryDto): Promise<PaperBatchDto> {
    return this.papers.getMany(parseIds(q.ids, PAPER_BATCH_MAX));
  }

  @Get(':paper_id')
  @WithLinks({ resource: (p: PaperDetail) => paperLinks(p.paper_id) })
  @ApiParam({
    name: 'paper_id',
    description:
      'URL-encoded; may contain "." and ":" (e.g. openalex%3AW2594538354)',
  })
  @ApiOkResponse({ type: PaperDetailDto })
  @ApiNotFoundResponse({ description: 'paper not found' })
  @ApiServiceUnavailableResponse({ description: 'qdrant unavailable' })
  get(@Param('paper_id') paperId: string): Promise<PaperDetail> {
    return this.papers.get(paperId);
  }
}
