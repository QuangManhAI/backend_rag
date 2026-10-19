import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { VectorStoreService } from './vector-store.service';

describe('VectorStoreService', () => {
  let service: VectorStoreService;

  const mockQueryBuilder = {
    distanceType: jest.fn().mockReturnThis(),
    metricType: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue([
      {
        chunk_id: 'paper_1_chunk_0',
        paper_id: '2401.0001',
        title: 'Deep Learning Review',
        authors: ['Alice Doe', 'Bob Smith'],
        primary_category: 'cs.AI',
        section_title: 'Introduction',
        section_type: 'introduction',
        text: 'This paper reviews recent advances in deep learning.',
        context_text: 'Paper: "Deep Learning Review" | Section: Introduction\n\nThis paper reviews...',
        word_count: 50,
        _distance: 0.12,
      },
    ]),
  };

  const mockTable = {
    search: jest.fn().mockReturnValue(mockQueryBuilder),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VectorStoreService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'LANCEDB_URI') return 'data/gold/lancedb';
              if (key === 'LANCEDB_TABLE') return 'scientific_papers_gold';
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<VectorStoreService>(VectorStoreService);
    (service as any).table = mockTable;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should throw BadRequestException if vector is not 768 dimensions', async () => {
    await expect(service.search([0.1, 0.2])).rejects.toThrow(BadRequestException);
  });

  it('should perform vector search and return chunks', async () => {
    const queryVector = new Array(768).fill(0.05);
    const results = await service.search(queryVector, 5, 'cs.AI');

    expect(mockTable.search).toHaveBeenCalledWith(queryVector);
    expect(mockQueryBuilder.distanceType).toHaveBeenCalledWith('cosine');
    expect(mockQueryBuilder.where).toHaveBeenCalledWith("primary_category = 'cs.AI'");
    expect(results).toHaveLength(1);
    expect(results[0].chunk_id).toBe('paper_1_chunk_0');
  });
});
