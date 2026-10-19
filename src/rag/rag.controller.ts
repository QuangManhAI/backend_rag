import { Controller, Post, Get, Body, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { RagService } from './rag.service';
import { QueryDto } from './dto/query.dto';
import { RAGSynthesisResponseDto, HealthResponseDto } from './dto/response.dto';
import { RAGSynthesisResponse } from '../types/scientific-rag';
import { VectorStoreService } from '../vector-store/vector-store.service';
import { LlmService } from '../llm/llm.service';

@ApiTags('Scientific RAG')
@Controller('api/rag')
export class RagController {
  private readonly logger = new Logger(RagController.name);

  constructor(
    private readonly ragService: RagService,
    private readonly vectorStoreService: VectorStoreService,
    private readonly llmService: LlmService,
  ) {}

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Query Scientific Literature with RAG',
    description:
      'Performs 768-D dense vector search across 913k scientific paper chunks, applies co-authorship PageRank and association-rules hybrid reranking, and synthesizes a grounded answer using local Qwen2.5-7B with strict [Paper: {paper_id}] citations.',
  })
  @ApiBody({ type: QueryDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully synthesized grounded answer with extracted academic citations and candidate chunks.',
    type: RAGSynthesisResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input payload, missing query, or out-of-range top_k.',
  })
  async chat(@Body() queryDto: QueryDto): Promise<RAGSynthesisResponse> {
    this.logger.log(`Received chat request: "${queryDto.query}"`);
    return this.ragService.executeRagPipeline(queryDto);
  }

  @Get('health')
  @ApiOperation({
    summary: 'Health and Hardware Acceleration Status',
    description:
      'Returns the readiness of the LanceDB vector store, local LLM inference engine, and detailed GPU hardware acceleration status (NVIDIA CUDA / Apple Metal / CPU).',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Service health and hardware acceleration diagnostics.',
    type: HealthResponseDto,
  })
  getHealth(): HealthResponseDto {
    return {
      status: 'ok',
      service: 'scientific-rag-backend',
      timestamp: new Date().toISOString(),
      components: {
        vectorStore: this.vectorStoreService.isReady() ? 'ready' : 'connecting_or_fallback',
        llm: this.llmService.isReady() ? 'ready' : 'fallback',
        gpu: this.llmService.getGpuStatus(),
      },
    };
  }
}
