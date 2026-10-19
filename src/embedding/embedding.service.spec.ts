import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';

describe('EmbeddingService', () => {
  let service: EmbeddingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EmbeddingService],
    }).compile();

    service = module.get<EmbeddingService>(EmbeddingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should throw BadRequestException on empty query', async () => {
    await expect(service.generateEmbedding('')).rejects.toThrow(BadRequestException);
    await expect(service.generateEmbedding('   ')).rejects.toThrow(BadRequestException);
  });

  it('should format input with search_query: and return 768-D vector with mock pipeline', async () => {
    // Mock embedder pipeline
    let calledInput = '';
    const mockOutput = {
      data: new Float32Array(768).fill(0.01),
    };
    (service as any).embedder = jest.fn().mockImplementation((input: string) => {
      calledInput = input;
      return Promise.resolve(mockOutput);
    });

    const vector = await service.generateEmbedding('attention mechanism in transformer');
    expect(calledInput).toBe('search_query: attention mechanism in transformer');
    expect(vector.length).toBe(768);
    expect(vector[0]).toBeCloseTo(0.01);
  });
});
