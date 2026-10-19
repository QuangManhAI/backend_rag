import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { QueryDto } from './query.dto';
import {
  GroundedChunkDto,
  RAGSynthesisResponseDto,
  HealthResponseDto,
  GpuStatusDto,
} from './response.dto';

describe('DTO Validation & Transformation', () => {
  describe('QueryDto', () => {
    it('should validate a valid QueryDto with default parameters', async () => {
      const plain = { query: 'What is self-attention?' };
      const dto = plainToInstance(QueryDto, plain);
      const errors = await validate(dto);

      expect(errors.length).toBe(0);
      expect(dto.query).toBe('What is self-attention?');
      expect(dto.top_k).toBe(5);
      expect(dto.use_authority_boost).toBe(true);
      expect(dto.expand_query).toBe(false);
    });

    it('should validate custom top_k, category, and flags', async () => {
      const plain = {
        query: 'Vision transformer adaptation',
        top_k: 10,
        category: 'cs.CV',
        use_authority_boost: false,
        expand_query: true,
      };
      const dto = plainToInstance(QueryDto, plain);
      const errors = await validate(dto);

      expect(errors.length).toBe(0);
      expect(dto.top_k).toBe(10);
      expect(dto.category).toBe('cs.CV');
      expect(dto.use_authority_boost).toBe(false);
      expect(dto.expand_query).toBe(true);
    });

    it('should fail validation if query is empty or missing', async () => {
      const dto = plainToInstance(QueryDto, { query: '' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'query')).toBe(true);
    });

    it('should fail validation if top_k is below 1 or above 20', async () => {
      const dtoLow = plainToInstance(QueryDto, { query: 'test', top_k: 0 });
      const errorsLow = await validate(dtoLow);
      expect(errorsLow.some((e) => e.property === 'top_k')).toBe(true);

      const dtoHigh = plainToInstance(QueryDto, { query: 'test', top_k: 25 });
      const errorsHigh = await validate(dtoHigh);
      expect(errorsHigh.some((e) => e.property === 'top_k')).toBe(true);
    });

    it('should transform numeric string to number for top_k', async () => {
      const plain = { query: 'test query', top_k: '7' };
      const dto = plainToInstance(QueryDto, plain);
      const errors = await validate(dto);

      expect(errors.length).toBe(0);
      expect(dto.top_k).toBe(7);
      expect(typeof dto.top_k).toBe('number');
    });
  });

  describe('Response DTOs', () => {
    it('should instantiate GroundedChunkDto and RAGSynthesisResponseDto', () => {
      const chunk = new GroundedChunkDto();
      chunk.chunk_id = 'chunk_1';
      chunk.paper_id = '2106.09685';
      chunk.title = 'LoRA';
      chunk.authors = ['Edward Hu'];
      chunk.primary_category = 'cs.CL';
      chunk.section_title = 'Abstract';
      chunk.text = 'LoRA text';
      chunk.similarity_score = 0.88;
      chunk.authority_score = 0.42;
      chunk.final_score = 0.81;
      chunk.citation_tag = '[Paper: 2106.09685]';

      expect(chunk.chunk_id).toBe('chunk_1');
      expect(chunk.final_score).toBe(0.81);

      const response = new RAGSynthesisResponseDto();
      response.query = 'query';
      response.answer = 'answer';
      response.citations = ['2106.09685'];
      response.grounded_chunks = [chunk];
      response.latency_ms = 950;

      expect(response.citations).toEqual(['2106.09685']);
      expect(response.grounded_chunks.length).toBe(1);
    });

    it('should instantiate HealthResponseDto and GpuStatusDto', () => {
      const gpu = new GpuStatusDto();
      gpu.hasGpu = true;
      gpu.type = 'cuda';
      gpu.platform = 'win32';
      gpu.arch = 'x64';
      gpu.details = 'RTX 4060';
      gpu.nodeLlamaGpuOption = 'cuda';

      const health = new HealthResponseDto();
      health.status = 'ok';
      health.service = 'scientific-rag-backend';
      health.timestamp = new Date().toISOString();
      health.components = {
        vectorStore: 'ready',
        llm: 'ready',
        gpu,
      };

      expect(health.status).toBe('ok');
      expect(health.components.gpu?.hasGpu).toBe(true);
    });
  });
});
