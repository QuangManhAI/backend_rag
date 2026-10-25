import * as fs from 'fs';
import * as path from 'path';
import { RetrievalRunner } from './retrieval.runner';
import { MockRetrievalAdapter } from './adapters';
import { DatasetItemInput } from '../datasets/schema';
import { generateMarkdownReport, saveMarkdownReport } from '../reports/markdown.reporter';
import { saveJsonReport } from '../reports/json.reporter';

describe('RetrievalRunner Integration Tests', () => {
  const tmpDir = path.join(__dirname, '..', '..', 'scratch', 'test_reports');

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  const testItems: DatasetItemInput[] = [
    {
      query_id: 'test_1',
      query: 'What is low-rank adaptation LoRA?',
      category: 'cs.LG',
      answerable: true,
      relevant_paper_ids: ['2106.09685'],
      relevant_chunk_ids: ['2106.09685_abs'],
      paper_relevance_grades: { '2106.09685': 3 },
    },
    {
      query_id: 'test_2',
      query: 'What is seed paper 0?',
      category: 'cs.LG',
      answerable: true,
      relevant_paper_ids: ['2400.10000'],
      paper_relevance_grades: { '2400.10000': 3 },
    },
    {
      query_id: 'test_3',
      query: 'Unanswerable query about baking',
      category: 'cooking',
      answerable: false,
    },
  ];

  it('runs retrieval benchmark with MockAdapter and computes pre and post rerank metrics', async () => {
    const adapter = new MockRetrievalAdapter((query) => {
      if (query.includes('LoRA')) {
        return [
          {
            chunk_id: '2106.09685_abs',
            paper_id: '2106.09685',
            title: 'LoRA paper',
            authors: ['Author 0', 'Edward Hu'],
            primary_category: 'cs.LG',
            year: 2021,
            section_title: 'Abstract',
            section_type: 'abstract',
            text: 'LoRA abstract text',
            score: 0.9,
          },
          {
            chunk_id: 'irr_1',
            paper_id: 'irr_1',
            title: 'Irrelevant 1',
            authors: ['Someone'],
            primary_category: 'cs.CV',
            year: 2020,
            section_title: 'Intro',
            section_type: 'introduction',
            text: 'Irrelevant text',
            score: 0.5,
          },
        ];
      }
      if (query.includes('seed paper 0')) {
        return [
          {
            chunk_id: 'irr_2',
            paper_id: 'irr_2',
            title: 'Irrelevant 2',
            authors: ['Someone'],
            primary_category: 'cs.CV',
            year: 2020,
            section_title: 'Intro',
            section_type: 'introduction',
            text: 'Irrelevant text',
            score: 0.95,
          },
          {
            chunk_id: '2400.10000_abs',
            paper_id: '2400.10000',
            title: 'Seed paper 0',
            authors: ['Author 0'], // Author 0 gets PageRank boost in MockAdapter
            primary_category: 'cs.LG',
            year: 2020,
            section_title: 'Abstract',
            section_type: 'abstract',
            text: 'Seed text',
            score: 0.85,
          },
        ];
      }
      return [];
    });

    const runner = new RetrievalRunner(adapter, {
      k_values: [1, 3],
      top_k: 3,
      use_authority_boost: true,
    });

    const suite = await runner.run(testItems, 'mock/path/test.jsonl');

    expect(suite.results).toHaveLength(3);
    expect(suite.duration_ms).toBeGreaterThanOrEqual(0);
    expect(suite.post_rerank_aggregated.evaluated_queries).toBe(2);
    expect(suite.post_rerank_aggregated.skipped_queries).toBe(1);

    // Query 1: LoRA was rank 1 in both pre and post
    const q1 = suite.results.find((r) => r.query_id === 'test_1')!;
    expect(q1.pre_rerank_metrics.paper_recall[1]).toBe(1.0);
    expect(q1.post_rerank_metrics.paper_recall[1]).toBe(1.0);

    // Query 2: In pre-rerank, 2400.10000 was rank 2 (score 0.85 < 0.95), so Recall@1 = 0
    // In post-rerank, Author 0 receives PageRank boost => moves to rank 1! Recall@1 = 1.0!
    const q2 = suite.results.find((r) => r.query_id === 'test_2')!;
    expect(q2.pre_rerank_metrics.paper_recall[1]).toBe(0.0);
    expect(q2.post_rerank_metrics.paper_recall[1]).toBe(1.0);
    expect(q2.post_rerank_metrics.paper_mrr[1]).toBe(1.0);

    // Verify reports can be generated and written
    const md = generateMarkdownReport(suite);
    expect(md).toContain('# RAG Retrieval Benchmark Report');
    expect(md).toContain('Ablation: Pre-Rerank vs Post-Rerank');

    const jsonPath = saveJsonReport(suite, tmpDir, 'test_report.json');
    const mdPath = saveMarkdownReport(suite, tmpDir, 'test_report.md');

    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(mdPath)).toBe(true);
  });

  it('resiliently catches and logs query-level adapter failures without throwing', async () => {
    const faultyAdapter = new MockRetrievalAdapter(() => {
      throw new Error('Connection timeout to vector store');
    });

    const runner = new RetrievalRunner(faultyAdapter, { k_values: [1, 5] });
    const suite = await runner.run(testItems);

    expect(suite.failed_queries).toHaveLength(3);
    expect(suite.failed_queries[0].error).toContain('Connection timeout');
    expect(suite.results[0].error).toContain('Connection timeout');
  });
});
