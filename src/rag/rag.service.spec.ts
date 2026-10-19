import { Test, TestingModule } from '@nestjs/testing';
import { RagService } from './rag.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { VectorStoreService } from '../vector-store/vector-store.service';
import { MiningService } from '../mining/mining.service';
import { LlmService } from '../llm/llm.service';

describe('RagService', () => {
  let service: RagService;

  const mockEmbeddingService = {
    generateEmbedding: jest.fn().mockResolvedValue(new Array(768).fill(0.01)),
  };

  const mockVectorStoreService = {
    search: jest.fn().mockResolvedValue([
      {
        chunk_id: 'c1',
        paper_id: '2310.00297',
        title: 'LoRA Paper',
        authors: ['Edward Hu'],
        primary_category: 'cs.CL',
        section_title: 'Method',
        section_type: 'method',
        text: 'LoRA freezes the pre-trained model weights...',
        context_text: 'ctx',
        word_count: 50,
      },
    ]),
  };

  const mockMiningService = {
    expandQueryTerms: jest.fn().mockReturnValue(['peft']),
    rerankChunks: jest.fn().mockReturnValue([
      {
        chunk_id: 'c1',
        paper_id: '2310.00297',
        title: 'LoRA Paper',
        authors: ['Edward Hu'],
        section_title: 'Method',
        text: 'LoRA freezes the pre-trained model weights...',
        similarity_score: 0.95,
        authority_score: 0.8,
        final_score: 0.92,
        citation_tag: '[Paper: 2310.00297]',
      },
    ]),
  };

  const mockLlmService = {
    generateGroundedAnswer: jest.fn().mockResolvedValue(
      'LoRA reduces parameters significantly by decomposing weight updates [Paper: 2310.00297].',
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RagService,
        { provide: EmbeddingService, useValue: mockEmbeddingService },
        { provide: VectorStoreService, useValue: mockVectorStoreService },
        { provide: MiningService, useValue: mockMiningService },
        { provide: LlmService, useValue: mockLlmService },
      ],
    }).compile();

    service = module.get<RagService>(RagService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should extract citations accurately', () => {
    const text =
      'According to [Paper: 2310.00297] and [Paper: 1706.03762], attention is all you need [Paper: 2310.00297].';
    const citations = service.extractCitations(text);
    expect(citations).toEqual(['2310.00297', '1706.03762']);
  });

  it('should execute end-to-end RAG pipeline successfully', async () => {
    const response = await service.executeRagPipeline({
      query: 'Explain LoRA',
      top_k: 1,
      expand_query: true,
      use_authority_boost: true,
    });

    expect(mockMiningService.expandQueryTerms).toHaveBeenCalledWith('Explain LoRA');
    expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalled();
    expect(mockVectorStoreService.search).toHaveBeenCalled();
    expect(mockMiningService.rerankChunks).toHaveBeenCalled();
    expect(mockLlmService.generateGroundedAnswer).toHaveBeenCalled();

    expect(response.query).toBe('Explain LoRA');
    expect(response.citations).toEqual(['2310.00297']);
    expect(response.grounded_chunks).toHaveLength(1);
    expect(response.latency_ms).toBeGreaterThanOrEqual(0);
  });
});
