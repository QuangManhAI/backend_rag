import {
  GenerationRunner,
  GenerationAdapter,
  GenerationOutput,
} from './generation.runner';
import { MockJudgeProvider } from '../evaluators/llm-judge.evaluator';
import { NO_CONTEXT_ANSWER } from '../../src/rag/prompt-builder';
import { DatasetItemInput } from '../datasets/schema';

describe('GenerationRunner', () => {
  class TestAdapter implements GenerationAdapter {
    async generate(
      query: string,
      fixedContexts?: Array<{ chunk_id: string; paper_id: string; text: string }>,
    ): Promise<GenerationOutput> {
      if (query.includes('fail-query')) {
        throw new Error('LLM generator crashed');
      }

      if (query.includes('unanswerable-query')) {
        return {
          answer: NO_CONTEXT_ANSWER,
          citations: [],
          grounded_chunks: [],
        };
      }

      if (query.includes('hallucination-query')) {
        return {
          answer: 'Transformer models utilize cross-entropy [Paper: paper_fake_999].',
          citations: ['paper_fake_999'],
          grounded_chunks: [
            {
              chunk_id: 'c1',
              paper_id: 'paper_real_1',
              text: 'Attention is all you need.',
            },
          ],
        };
      }

      // Default normal generation
      return {
        answer: 'Transformer models replace recurrence with self-attention [Paper: paper_real_1].',
        citations: ['paper_real_1'],
        grounded_chunks: [
          {
            chunk_id: 'c1',
            paper_id: 'paper_real_1',
            text: 'We propose the Transformer model architecture based solely on attention mechanisms.',
          },
        ],
      };
    }
  }

  const sampleItems: DatasetItemInput[] = [
    {
      query_id: 'q1',
      query: 'What architecture does Transformer use?',
      category: 'architecture',
      answerable: true,
      reference_answer: 'The Transformer architecture is based on self-attention mechanisms without recurrence.',
      reference_citations: ['paper_real_1'],
    },
    {
      query_id: 'q2',
      query: 'What is unanswerable-query about future quantum gravity in 2050?',
      category: 'abstention_test',
      answerable: false,
      expected_abstention: true,
    },
    {
      query_id: 'q3',
      query: 'What is hallucination-query finding?',
      category: 'hallucination_test',
      answerable: true,
      expected_abstention: false,
      reference_citations: ['paper_real_1'],
    },
    {
      query_id: 'q4',
      query: 'What is fail-query?',
      category: 'error_test',
      answerable: true,
      expected_abstention: false,
      reference_citations: ['paper_real_1'],
    },
  ];

  it('runs end-to-end evaluation suite and aggregates metrics correctly', async () => {
    const adapter = new TestAdapter();
    const judge = new MockJudgeProvider();
    const runner = new GenerationRunner(adapter, judge);

    const result = await runner.run(sampleItems, 'test_dataset.jsonl');

    expect(result.config.adapter_name).toBe('TestAdapter');
    expect(result.config.judge_enabled).toBe(true);
    expect(result.config.judge_name).toBe('MockJudgeProvider');
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);

    const agg = result.aggregated_metrics;
    expect(agg.total_samples).toBe(4);
    expect(agg.successful_evaluations).toBe(3);
    expect(agg.failed_evaluations).toBe(1);

    // Citations
    expect(agg.total_hallucinated_citations).toBe(1);
    expect(agg.total_citations_found).toBeGreaterThan(0);

    // Abstention
    expect(agg.abstention.expected_abstention_count).toBe(1);
    expect(agg.abstention.true_abstention_count).toBe(1);
    expect(agg.abstention.abstention_precision).toBe(1.0);
    expect(agg.abstention.abstention_recall).toBe(1.0);

    // Judge averages
    expect(agg.judge_averages).toBeDefined();
    expect(agg.judge_averages?.mean_faithfulness_score_1_to_5).toBeGreaterThan(0);
    expect(agg.judge_averages?.mean_relevance_score_1_to_5).toBeGreaterThan(0);

    // Category breakdown
    expect(agg.by_category['architecture']).toBeDefined();
    expect(agg.by_category['architecture'].sample_count).toBe(1);
    expect(agg.by_category['abstention_test']).toBeDefined();

    // Verify error was recorded for q4
    const q4Result = result.results.find((r) => r.query_id === 'q4');
    expect(q4Result?.error).toContain('LLM generator crashed');
  });
});
