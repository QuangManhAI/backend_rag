import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GroundedChunkDto {
  @ApiProperty({ description: 'Unique identifier of the text chunk', example: '2106.09685_sec8' })
  chunk_id!: string;

  @ApiProperty({ description: 'arXiv or publication identifier of the source paper', example: '2106.09685' })
  paper_id!: string;

  @ApiProperty({ description: 'Title of the research paper', example: 'LoRA: Low-Rank Adaptation of Large Language Models' })
  title!: string;

  @ApiPropertyOptional({ description: 'List of authors', type: [String], example: ['J. Edward Hu', 'Yelong Shen', 'Phillip Wallis'] })
  authors?: string[];

  @ApiPropertyOptional({ description: 'Primary arXiv research category', example: 'cs.CL' })
  primary_category?: string;

  @ApiPropertyOptional({ description: 'Section title from which the chunk originated', example: '8 Conclusion and Future Work' })
  section_title?: string;

  @ApiProperty({ description: 'Full text content of the chunk' })
  text!: string;

  @ApiProperty({ description: 'Cosine vector similarity score (0.0 to 1.0)', example: 0.5278 })
  similarity_score!: number;

  @ApiProperty({ description: 'PageRank co-authorship authority score (0.0 to 1.0)', example: 0.3059 })
  authority_score!: number;

  @ApiProperty({ description: 'Final blended ranking score', example: 0.4945 })
  final_score!: number;

  @ApiProperty({ description: 'Academic citation tag formatted for prompt grounding', example: '[Paper: 2106.09685]' })
  citation_tag!: string;
}

export class RAGSynthesisResponseDto {
  @ApiProperty({ description: 'Original user input query', example: 'How does LoRA optimize large models?' })
  query!: string;

  @ApiProperty({ description: 'Synthesized grounded answer containing verified [Paper: {paper_id}] citations' })
  answer!: string;

  @ApiProperty({ description: 'Extracted paper IDs cited in the answer', type: [String], example: ['2106.09685'] })
  citations!: string[];

  @ApiProperty({ description: 'List of grounded candidate chunks used for context', type: [GroundedChunkDto] })
  grounded_chunks!: GroundedChunkDto[];

  @ApiProperty({ description: 'Total end-to-end pipeline latency in milliseconds', example: 14185 })
  latency_ms!: number;
}

export class GpuStatusDto {
  @ApiProperty({ description: 'Whether dedicated or integrated hardware acceleration was detected', example: true })
  hasGpu!: boolean;

  @ApiProperty({ description: 'Acceleration backend type', enum: ['cuda', 'metal', 'vulkan', 'cpu'], example: 'cuda' })
  type!: string;

  @ApiProperty({ description: 'Operating system platform', example: 'win32' })
  platform!: string;

  @ApiProperty({ description: 'CPU/GPU hardware architecture', example: 'x64' })
  arch!: string;

  @ApiProperty({ description: 'Human-readable hardware details', example: 'NVIDIA CUDA (NVIDIA GeForce RTX 4060 Laptop GPU, 581.80, 8188 MiB)' })
  details!: string;

  @ApiProperty({ description: 'node-llama-cpp GPU configuration parameter', example: 'cuda', oneOf: [{ type: 'string' }, { type: 'boolean' }] })
  nodeLlamaGpuOption!: string | boolean;
}

export class HealthComponentsDto {
  @ApiProperty({ description: 'LanceDB vector store status', example: 'ready' })
  vectorStore!: string;

  @ApiProperty({ description: 'Local LLM inference engine status', example: 'ready' })
  llm!: string;

  @ApiProperty({ description: 'Detailed GPU hardware profiling and status', type: GpuStatusDto, nullable: true })
  gpu!: GpuStatusDto | null;
}

export class HealthResponseDto {
  @ApiProperty({ description: 'Overall system health indicator', example: 'ok' })
  status!: string;

  @ApiProperty({ description: 'Service identifier name', example: 'scientific-rag-backend' })
  service!: string;

  @ApiProperty({ description: 'ISO 8601 server timestamp', example: '2026-10-14T09:55:47.807Z' })
  timestamp!: string;

  @ApiProperty({ description: 'Detailed component health indicators', type: HealthComponentsDto })
  components!: HealthComponentsDto;
}
