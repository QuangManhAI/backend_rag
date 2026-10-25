import * as fs from 'fs';
import * as path from 'path';
import { IntegratedRunner } from './integrated.runner';
import { RetrievalAdapter } from './retrieval.runner';
import { GenerationAdapter } from './generation.runner';
import { MockRetrievalAdapter } from './adapters';
import { NO_CONTEXT_ANSWER } from '../../src/rag/prompt-builder';
import { generateTechnicalReport } from '../reports/integrated-technical.reporter';
import { generateExecutiveSummary } from '../reports/integrated-executive.reporter';

describe('IntegratedRunner', () => {
  const tempOutputDir = path.resolve(__dirname, '../reports/test-output');

  beforeAll(() => {
    if (!fs.existsSync(tempOutputDir)) {
      fs.mkdirSync(tempOutputDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(tempOutputDir)) {
      fs.rmSync(tempOutputDir, { recursive: true, force: true });
    }
  });

  class MockTestGenerationAdapter implements GenerationAdapter {
    async generate(query: string) {
      if (query.includes('unanswerable')) {
        return {
          answer: NO_CONTEXT_ANSWER,
          citations: [],
          grounded_chunks: [],
        };
      }
      return {
        answer: 'This is a test finding [Paper: p1].',
        citations: ['p1'],
        grounded_chunks: [{ chunk_id: 'c1', paper_id: 'p1', text: 'This is a test finding.' }],
      };
    }
  }

  it('runs all suites successfully and produces consistent reports', async () => {
    const runner = new IntegratedRunner();
    const result = await runner.run({
      outputDir: tempOutputDir,
      k_values: [1, 3, 5],
      judge_type: 'mock',
      runtime_scenario: 'smoke',
      retrievalAdapter: new MockRetrievalAdapter(),
      generationAdapter: new MockTestGenerationAdapter(),
    });

    expect(result.metadata.overall_status).toBe('completed');
    expect(result.metadata.run_id).toBeDefined();
    expect(result.suites.retrieval.status).toBe('completed');
    expect(result.suites.generation.status).toBe('completed');
    expect(result.suites.runtime.status).toBe('completed');

    // Verify consistency between Technical Report and Executive Summary
    const techMd = generateTechnicalReport(result);
    const execMd = generateExecutiveSummary(result);

    // Both must contain the exact same Run ID
    expect(techMd).toContain(result.metadata.run_id);
    expect(execMd).toContain(result.metadata.run_id);

    // Both must reference the exact same citation precision
    const citPrec = result.tradeoffs.citation_reliability.in_context_precision_pct;
    expect(techMd).toContain(`${citPrec.toFixed(2)}%`);
    expect(execMd).toContain(`${citPrec.toFixed(2)}%`);
  });

  it('handles partial failure gracefully when one suite errors out', async () => {
    class FailingRetrievalAdapter implements RetrievalAdapter {
      async execute(): Promise<any> {
        throw new Error('Vector DB Connection Timeout (Simulated Failure)');
      }
    }

    const runner = new IntegratedRunner();
    const result = await runner.run({
      outputDir: tempOutputDir,
      judge_type: 'mock',
      runtime_scenario: 'smoke',
      retrievalAdapter: new FailingRetrievalAdapter(),
      generationAdapter: new MockTestGenerationAdapter(),
    });

    // Retrieval failed, but Generation and Runtime succeeded -> 'partial'
    expect(result.metadata.overall_status).toBe('partial');
    expect(result.suites.retrieval.status).toBe('failed');
    expect(result.suites.retrieval.error).toContain('Vector DB Connection Timeout');
    expect(result.suites.generation.status).toBe('completed');
    expect(result.suites.runtime.status).toBe('completed');

    // Generating reports must still succeed without throwing
    const techMd = generateTechnicalReport(result);
    const execMd = generateExecutiveSummary(result);

    expect(techMd).toContain('Vector DB Connection Timeout');
    expect(execMd).toContain('PARTIAL');
  });

  it('correctly marks skipped suites and avoids generating hallucinated metrics', async () => {
    const runner = new IntegratedRunner();
    const result = await runner.run({
      outputDir: tempOutputDir,
      suites_to_run: ['retrieval'],
      retrievalAdapter: new MockRetrievalAdapter(),
    });

    expect(result.suites.retrieval.status).toBe('completed');
    expect(result.suites.generation.status).toBe('skipped');
    expect(result.suites.runtime.status).toBe('skipped');

    const techMd = generateTechnicalReport(result);
    expect(techMd).toContain('Suite Generation không hoàn thành hoặc bị bỏ qua');
    expect(techMd).toContain('Suite Runtime không hoàn thành hoặc bị bỏ qua');
  });
});
