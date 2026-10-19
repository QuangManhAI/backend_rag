import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MiningService } from './mining.service';
import { ScientificChunk } from '../types/scientific-rag';

describe('MiningService', () => {
  let service: MiningService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MiningService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(null),
          },
        },
      ],
    }).compile();

    service = module.get<MiningService>(MiningService);

    // Setup mock influencers and rules
    (service as any).influencers = new Map<string, number>([
      ['yoshua bengio', 0.01],
      ['geoffrey hinton', 0.012],
    ]);
    (service as any).maxPageRank = 0.012;

    (service as any).rules = [
      {
        antecedents: ['lora'],
        consequents: ['peft', 'parameter-efficient'],
        support: 0.1,
        confidence: 0.9,
        lift: 2.5,
      },
    ];
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should calculate positive authority score for known influencers', () => {
    const score = service.getAuthorityScore(['Geoffrey Hinton', 'Unknown Author']);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it('should return 0.0 authority score for unknown authors', () => {
    const score = service.getAuthorityScore(['Random Nobody']);
    expect(score).toBe(0.0);
  });

  it('should expand query terms using association rules', () => {
    const expanded = service.expandQueryTerms('How does LoRA fine-tuning work?');
    expect(expanded).toContain('peft');
    expect(expanded).toContain('parameter-efficient');
  });

  it('should rerank chunks and calculate final_score (0.85 sim + 0.15 auth)', () => {
    const chunks: ScientificChunk[] = [
      {
        chunk_id: 'c1',
        paper_id: 'p1',
        title: 'Unknown Paper',
        authors: ['Nobody'],
        primary_category: 'cs.AI',
        section_title: 'Method',
        section_type: 'method',
        text: 'some content',
        context_text: 'ctx',
        word_count: 10,
        _distance: 0.2, // sim = 0.8 -> final = 0.85 * 0.8 + 0 = 0.68
      },
      {
        chunk_id: 'c2',
        paper_id: 'p2',
        title: 'Seminal Hinton Paper',
        authors: ['Geoffrey Hinton'],
        primary_category: 'cs.AI',
        section_title: 'Method',
        section_type: 'method',
        text: 'deep learning content',
        context_text: 'ctx',
        word_count: 10,
        _distance: 0.25, // sim = 0.75, auth = 1.0 -> final = 0.85 * 0.75 + 0.15 * 1.0 = 0.6375 + 0.15 = 0.7875
      },
    ];

    const reranked = service.rerankChunks(chunks, true);
    expect(reranked[0].chunk_id).toBe('c2'); // c2 should be boosted to first place
    expect(reranked[0].citation_tag).toBe('[Paper: p2]');
    expect(reranked[0].final_score).toBeGreaterThan(reranked[1].final_score);
  });
});
