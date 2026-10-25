import { DatasetItemInput, datasetItemSchema } from '../datasets/schema';
import {
  AnswerCorrectnessResult,
  evaluateAnswerCorrectness,
} from '../evaluators/answer-correctness.evaluator';
import {
  evaluateFaithfulness,
  FaithfulnessResult,
} from '../evaluators/faithfulness.evaluator';
import {
  AnswerRelevanceResult,
  evaluateAnswerRelevance,
} from '../evaluators/answer-relevance.evaluator';
import {
  CitationEvaluationResult,
  evaluateCitations,
} from '../evaluators/citation.evaluator';
import {
  aggregateAbstentionMetrics,
  AggregatedAbstentionMetrics,
  evaluateSingleAbstention,
  SingleAbstentionEvaluation,
} from '../evaluators/abstention.evaluator';
import {
  JudgeEvaluation,
  LlmJudgeProvider,
  RUBRIC_VERSION,
} from '../evaluators/llm-judge.evaluator';

export interface GenerationOutput {
  answer: string;
  citations: string[];
  grounded_chunks: Array<{ chunk_id: string; paper_id: string; text: string }>;
  timings?: {
    llm_ms: number;
    total_ms: number;
  };
}

export interface GenerationAdapter {
  generate(
    query: string,
    fixedContexts?: Array<{ chunk_id: string; paper_id: string; text: string }>,
  ): Promise<GenerationOutput>;
}

export interface SingleGenerationEvaluationResult {
  query_id: string;
  query: string;
  category?: string;
  answerable: boolean;
  expected_abstention: boolean;

  answer: string;
  citations: string[];
  retrieved_chunk_count: number;

  correctness: AnswerCorrectnessResult;
  faithfulness: FaithfulnessResult;
  relevance: AnswerRelevanceResult;
  citations_eval: CitationEvaluationResult;
  abstention_eval: SingleAbstentionEvaluation;

  judge_evaluations?: {
    provider_name: string;
    rubric_version: string;
    faithfulness?: JudgeEvaluation;
    correctness?: JudgeEvaluation;
    relevance?: JudgeEvaluation;
  };

  error?: string;
}

export interface AggregatedGenerationMetrics {
  total_samples: number;
  successful_evaluations: number;
  failed_evaluations: number;

  // Correctness
  mean_token_f1: number;
  mean_rouge_l_f1: number;
  exact_match_rate: number;

  // Faithfulness
  mean_faithfulness_score: number;
  total_claims_evaluated: number;
  total_supported_claims: number;

  // Relevance
  mean_relevance_score: number;
  mean_query_coverage: number;

  // Citations
  mean_citation_id_precision: number;
  mean_citation_completeness: number;
  mean_citation_support_ratio: number;
  total_citations_found: number;
  total_hallucinated_citations: number;

  // Abstention
  abstention: AggregatedAbstentionMetrics;

  // Judge scores (if enabled)
  judge_averages?: {
    mean_faithfulness_score_1_to_5: number;
    mean_correctness_score_1_to_5: number;
    mean_relevance_score_1_to_5: number;
  };

  // Category breakdown
  by_category: Record<
    string,
    {
      sample_count: number;
      mean_faithfulness: number;
      mean_rouge_l: number;
      citation_id_precision: number;
    }
  >;
}

export interface GenerationSuiteResult {
  config: {
    dataset_path?: string;
    adapter_name: string;
    judge_enabled: boolean;
    judge_name?: string;
    rubric_version: string;
  };
  duration_ms: number;
  aggregated_metrics: AggregatedGenerationMetrics;
  results: SingleGenerationEvaluationResult[];
}

export class GenerationRunner {
  constructor(
    private readonly adapter: GenerationAdapter,
    private readonly judgeProvider?: LlmJudgeProvider,
  ) {}

  async run(
    items: DatasetItemInput[],
    datasetPath?: string,
  ): Promise<GenerationSuiteResult> {
    const validatedItems = items.map((it) => datasetItemSchema.parse(it));
    const results: SingleGenerationEvaluationResult[] = [];
    const startTime = performance.now();

    for (const item of validatedItems) {
      const expectedAbstention =
        item.expected_abstention !== undefined
          ? item.expected_abstention
          : !item.answerable;

      try {
        const out = await this.adapter.generate(
          item.query,
          item.fixed_contexts,
        );

        const correctness = evaluateAnswerCorrectness(
          out.answer,
          item.reference_answer,
        );

        const faithfulness = evaluateFaithfulness(
          out.answer,
          out.grounded_chunks,
        );

        const relevance = evaluateAnswerRelevance(item.query, out.answer);

        const citationsEval = evaluateCitations(
          out.answer,
          out.grounded_chunks,
          item.reference_citations,
        );

        const abstentionEval = evaluateSingleAbstention(
          out.answer,
          expectedAbstention,
        );

        let judgeEvaluations;
        if (this.judgeProvider) {
          const contextText = out.grounded_chunks
            .map((c) => `[Paper: ${c.paper_id}] ${c.text}`)
            .join('\n\n');

          const faithJudge = await this.judgeProvider.evaluate({
            query: item.query,
            context: contextText,
            answer: out.answer,
            aspect: 'faithfulness',
          });

          const corrJudge = item.reference_answer
            ? await this.judgeProvider.evaluate({
                query: item.query,
                context: contextText,
                answer: out.answer,
                reference_answer: item.reference_answer,
                aspect: 'correctness',
              })
            : undefined;

          const relJudge = await this.judgeProvider.evaluate({
            query: item.query,
            context: contextText,
            answer: out.answer,
            aspect: 'relevance',
          });

          judgeEvaluations = {
            provider_name: this.judgeProvider.name,
            rubric_version: RUBRIC_VERSION,
            faithfulness: faithJudge,
            correctness: corrJudge,
            relevance: relJudge,
          };
        }

        results.push({
          query_id: item.query_id,
          query: item.query,
          category: item.category,
          answerable: item.answerable,
          expected_abstention: expectedAbstention,
          answer: out.answer,
          citations: out.citations,
          retrieved_chunk_count: out.grounded_chunks.length,
          correctness,
          faithfulness,
          relevance,
          citations_eval: citationsEval,
          abstention_eval: abstentionEval,
          judge_evaluations: judgeEvaluations,
        });
      } catch (err) {
        const errorMsg = (err as Error).message;
        results.push({
          query_id: item.query_id,
          query: item.query,
          category: item.category,
          answerable: item.answerable,
          expected_abstention: expectedAbstention,
          answer: '',
          citations: [],
          retrieved_chunk_count: 0,
          correctness: {
            has_reference: false,
            token_f1: { precision: 0, recall: 0, f1: 0 },
            rouge_l: { precision: 0, recall: 0, f1: 0 },
            exact_match: false,
          },
          faithfulness: {
            total_claims: 0,
            supported_claims: 0,
            unsupported_claims: 0,
            faithfulness_score: 0,
            claim_details: [],
          },
          relevance: {
            query_keyword_coverage: 0,
            is_direct_and_concise: false,
            length_chars: 0,
            relevance_score: 0,
          },
          citations_eval: {
            total_citations_found: 0,
            extracted_citation_ids: [],
            format_valid: false,
            malformed_citations: [],
            in_context_citations: [],
            hallucinated_citations: [],
            id_precision: 0,
            supported_citations: [],
            unsupported_citations: [],
            citation_support_ratio: 0,
            total_claims: 0,
            claims_with_citations: 0,
            citation_completeness_ratio: 0,
          },
          abstention_eval: {
            is_abstention: false,
            expected_abstention: expectedAbstention,
            is_true_abstention: false,
            is_false_abstention: false,
            is_unsupported_answer: false,
          },
          error: errorMsg,
        });
      }
    }

    const duration_ms = Math.round(performance.now() - startTime);
    const aggregated = this.aggregateMetrics(results);

    return {
      config: {
        dataset_path: datasetPath,
        adapter_name: this.adapter.constructor.name,
        judge_enabled: !!this.judgeProvider,
        judge_name: this.judgeProvider?.name,
        rubric_version: RUBRIC_VERSION,
      },
      duration_ms,
      aggregated_metrics: aggregated,
      results,
    };
  }

  private aggregateMetrics(
    results: SingleGenerationEvaluationResult[],
  ): AggregatedGenerationMetrics {
    const validResults = results.filter((r) => !r.error);
    const total = results.length;
    const successful = validResults.length;
    const failed = total - successful;

    const round4 = (x: number) => Math.round(x * 1e4) / 1e4;
    const avg = (fn: (r: SingleGenerationEvaluationResult) => number) =>
      successful > 0
        ? round4(validResults.reduce((s, r) => s + fn(r), 0) / successful)
        : 0;

    // Filter reference-only for correctness
    const withRef = validResults.filter((r) => r.correctness.has_reference);
    const meanTokenF1 =
      withRef.length > 0
        ? round4(
            withRef.reduce((s, r) => s + r.correctness.token_f1.f1, 0) /
              withRef.length,
          )
        : 0;
    const meanRougeL =
      withRef.length > 0
        ? round4(
            withRef.reduce((s, r) => s + r.correctness.rouge_l.f1, 0) /
              withRef.length,
          )
        : 0;
    const exactMatchRate =
      withRef.length > 0
        ? round4(
            withRef.filter((r) => r.correctness.exact_match).length /
              withRef.length,
          )
        : 0;

    // Citations
    let totalCitations = 0;
    let totalHallucinated = 0;
    for (const r of validResults) {
      totalCitations += r.citations_eval.total_citations_found;
      totalHallucinated += r.citations_eval.hallucinated_citations.length;
    }

    const abstentionAgg = aggregateAbstentionMetrics(
      results.map((r) => r.abstention_eval),
    );

    // Judge averages
    let judgeAverages;
    const withJudge = validResults.filter((r) => !!r.judge_evaluations);
    if (withJudge.length > 0) {
      const faithSum = withJudge.reduce(
        (s, r) => s + (r.judge_evaluations?.faithfulness?.score || 0),
        0,
      );
      const relSum = withJudge.reduce(
        (s, r) => s + (r.judge_evaluations?.relevance?.score || 0),
        0,
      );
      const corrList = withJudge.filter(
        (r) => !!r.judge_evaluations?.correctness,
      );
      const corrSum = corrList.reduce(
        (s, r) => s + (r.judge_evaluations?.correctness?.score || 0),
        0,
      );

      judgeAverages = {
        mean_faithfulness_score_1_to_5: round4(faithSum / withJudge.length),
        mean_correctness_score_1_to_5:
          corrList.length > 0 ? round4(corrSum / corrList.length) : 0,
        mean_relevance_score_1_to_5: round4(relSum / withJudge.length),
      };
    }

    // Category breakdown
    const byCategory: AggregatedGenerationMetrics['by_category'] = {};
    const categories = Array.from(
      new Set(results.map((r) => r.category || 'uncategorized')),
    );

    for (const cat of categories) {
      const catResults = validResults.filter(
        (r) => (r.category || 'uncategorized') === cat,
      );
      const catCount = catResults.length;
      if (catCount === 0) continue;

      const catFaith =
        catResults.reduce((s, r) => s + r.faithfulness.faithfulness_score, 0) /
        catCount;
      const catRouge =
        catResults.reduce((s, r) => s + r.correctness.rouge_l.f1, 0) / catCount;
      const catCitPrec =
        catResults.reduce((s, r) => s + r.citations_eval.id_precision, 0) /
        catCount;

      byCategory[cat] = {
        sample_count: catCount,
        mean_faithfulness: round4(catFaith),
        mean_rouge_l: round4(catRouge),
        citation_id_precision: round4(catCitPrec),
      };
    }

    return {
      total_samples: total,
      successful_evaluations: successful,
      failed_evaluations: failed,
      mean_token_f1: meanTokenF1,
      mean_rouge_l_f1: meanRougeL,
      exact_match_rate: exactMatchRate,
      mean_faithfulness_score: avg((r) => r.faithfulness.faithfulness_score),
      total_claims_evaluated: validResults.reduce(
        (s, r) => s + r.faithfulness.total_claims,
        0,
      ),
      total_supported_claims: validResults.reduce(
        (s, r) => s + r.faithfulness.supported_claims,
        0,
      ),
      mean_relevance_score: avg((r) => r.relevance.relevance_score),
      mean_query_coverage: avg((r) => r.relevance.query_keyword_coverage),
      mean_citation_id_precision: avg((r) => r.citations_eval.id_precision),
      mean_citation_completeness: avg(
        (r) => r.citations_eval.citation_completeness_ratio,
      ),
      mean_citation_support_ratio: avg(
        (r) => r.citations_eval.citation_support_ratio,
      ),
      total_citations_found: totalCitations,
      total_hallucinated_citations: totalHallucinated,
      abstention: abstentionAgg,
      judge_averages: judgeAverages,
      by_category: byCategory,
    };
  }
}
