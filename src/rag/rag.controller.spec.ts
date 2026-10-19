import { Test, TestingModule } from '@nestjs/testing';
import { RagController } from './rag.controller';
import { RagService } from './rag.service';
import { VectorStoreService } from '../vector-store/vector-store.service';
import { LlmService } from '../llm/llm.service';
import { QueryDto } from './dto/query.dto';
import { RAGSynthesisResponse } from '../types/scientific-rag';

describe('RagController', () => {
  let controller: RagController;
  let ragService: jest.Mocked<RagService>;
  let vectorStoreService: jest.Mocked<VectorStoreService>;
  let llmService: jest.Mocked<LlmService>;

  const mockResponse: RAGSynthesisResponse = {
    query: 'How does LoRA work?',
    answer: 'LoRA uses low-rank adapters [Paper: 2106.09685].',
    citations: ['2106.09685'],
    grounded_chunks: [
      {
        chunk_id: '2106.09685_0',
        paper_id: '2106.09685',
        title: 'LoRA',
        authors: ['E. Hu'],
        section_title: 'Introduction',
        text: 'LoRA freezes weights',
        similarity_score: 0.9,
        authority_score: 0.5,
        final_score: 0.84,
        citation_tag: '[Paper: 2106.09685]',
      },
    ],
    latency_ms: 1250,
  };

  beforeEach(async () => {
    const mockRagService = {
      executeRagPipeline: jest.fn().mockResolvedValue(mockResponse),
    };

    const mockVectorStoreService = {
      isReady: jest.fn().mockReturnValue(true),
    };

    const mockLlmService = {
      isReady: jest.fn().mockReturnValue(true),
      getGpuStatus: jest.fn().mockReturnValue({
        hasGpu: true,
        type: 'cuda',
        platform: 'win32',
        arch: 'x64',
        details: 'NVIDIA CUDA',
        nodeLlamaGpuOption: 'cuda',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RagController],
      providers: [
        { provide: RagService, useValue: mockRagService },
        { provide: VectorStoreService, useValue: mockVectorStoreService },
        { provide: LlmService, useValue: mockLlmService },
      ],
    }).compile();

    controller = module.get<RagController>(RagController);
    ragService = module.get(RagService);
    vectorStoreService = module.get(VectorStoreService);
    llmService = module.get(LlmService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('chat', () => {
    it('should pass queryDto to ragService.executeRagPipeline and return response', async () => {
      const dto: QueryDto = {
        query: 'How does LoRA work?',
        top_k: 5,
        use_authority_boost: true,
        expand_query: false,
      };

      const result = await controller.chat(dto);
      expect(ragService.executeRagPipeline).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getHealth', () => {
    it('should return ok status with components ready when vectorStore and llm are ready', () => {
      vectorStoreService.isReady.mockReturnValue(true);
      llmService.isReady.mockReturnValue(true);

      const health = controller.getHealth();
      expect(health.status).toBe('ok');
      expect(health.service).toBe('scientific-rag-backend');
      expect(health.components.vectorStore).toBe('ready');
      expect(health.components.llm).toBe('ready');
      expect(health.components.gpu?.type).toBe('cuda');
    });

    it('should return connecting_or_fallback and fallback when components are not ready', () => {
      vectorStoreService.isReady.mockReturnValue(false);
      llmService.isReady.mockReturnValue(false);
      llmService.getGpuStatus.mockReturnValue(null);

      const health = controller.getHealth();
      expect(health.components.vectorStore).toBe('connecting_or_fallback');
      expect(health.components.llm).toBe('fallback');
      expect(health.components.gpu).toBeNull();
    });
  });
});
