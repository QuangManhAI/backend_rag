import { z } from 'zod';

/**
 * Zod schema for a single ground truth evaluation item.
 * Supports both paper-level and chunk-level evaluation, with binary or graded relevance.
 */
export const datasetItemSchema = z
  .object({
    /** Unique identifier for the query sample */
    query_id: z.string().trim().min(1, 'query_id is required'),

    /** The natural language question to be benchmarked */
    query: z.string().trim().min(1, 'query is required'),

    /** Domain category (e.g. arXiv code: cs.LG, cs.CL, stat.ML, or domain name) */
    category: z.string().trim().optional(),

    /**
     * Whether the query is answerable by the corpus.
     * If false, ideal retrieval should yield no false-positive contexts or low similarity.
     */
    answerable: z.boolean().default(true),

    /**
     * Relevant paper IDs (e.g. ["2106.09685", "1706.03762"]).
     * Used for binary paper-level Recall@K, MRR@K, Precision@K.
     */
    relevant_paper_ids: z
      .array(z.string().trim().min(1))
      .transform((arr) => Array.from(new Set(arr)))
      .optional()
      .default([]),

    /**
     * Graded relevance scores for paper IDs (e.g. { "2106.09685": 3, "1706.03762": 1 }).
     * Used for paper-level nDCG@K.
     */
    paper_relevance_grades: z
      .record(z.string().trim().min(1), z.number().min(0))
      .optional()
      .default({}),

    /**
     * Relevant chunk IDs (e.g. ["2106.09685_abs", "2106.09685_sec2"]).
     * Used for binary chunk-level Recall@K, MRR@K, Precision@K.
     */
    relevant_chunk_ids: z
      .array(z.string().trim().min(1))
      .transform((arr) => Array.from(new Set(arr)))
      .optional()
      .default([]),

    /**
     * Graded relevance scores for chunk IDs (e.g. { "2106.09685_abs": 2, "2106.09685_sec2": 1 }).
     * Used for chunk-level nDCG@K.
     */
    chunk_relevance_grades: z
      .record(z.string().trim().min(1), z.number().min(0))
      .optional()
      .default({}),

    /** Optional reference answer string (used in Phase 4 generation benchmark) */
    reference_answer: z.string().trim().optional(),

    /** Verified reference citation paper IDs */
    reference_citations: z
      .array(z.string().trim().min(1))
      .transform((arr) => Array.from(new Set(arr)))
      .optional()
      .default([]),

    /** Whether the system is expected to abstain / state lack of evidence */
    expected_abstention: z.boolean().optional(),

    /** Optional fixed context chunks for isolated generation testing */
    fixed_contexts: z
      .array(
        z.object({
          chunk_id: z.string().min(1),
          paper_id: z.string().min(1),
          title: z.string().optional().default(''),
          text: z.string().min(1),
        }),
      )
      .optional(),

    /** Optional notes or metadata for the sample */
    notes: z.string().trim().optional(),
  })
  .superRefine((data, ctx) => {
    // If the sample is marked answerable, it must have at least one ground truth indicator
    if (data.answerable) {
      const hasPaperIds = (data.relevant_paper_ids ?? []).length > 0;
      const hasChunkIds = (data.relevant_chunk_ids ?? []).length > 0;
      const hasPaperGrades =
        Object.keys(data.paper_relevance_grades ?? {}).length > 0;
      const hasChunkGrades =
        Object.keys(data.chunk_relevance_grades ?? {}).length > 0;
      const hasRefCitations =
        (data.reference_citations ?? []).length > 0;
      const hasFixedContexts =
        (data.fixed_contexts ?? []).length > 0;

      if (
        !hasPaperIds &&
        !hasChunkIds &&
        !hasPaperGrades &&
        !hasChunkGrades &&
        !hasRefCitations &&
        !hasFixedContexts
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Answerable query must specify at least one relevant paper_id, chunk_id, relevance grade, reference citation, or fixed context',
          path: ['relevant_paper_ids'],
        });
      }
    }
  });

export type DatasetItem = z.infer<typeof datasetItemSchema>;
export type DatasetItemInput = z.input<typeof datasetItemSchema>;

/** Metadata describing the evaluation dataset */
export const datasetMetadataSchema = z.object({
  version: z.string().default('1.0.0'),
  name: z.string().default('RAG Retrieval Benchmark Dataset'),
  description: z.string().optional(),
  corpus_type: z.enum(['real', 'synthetic', 'mock']).default('real'),
  created_at: z.string().default(() => new Date().toISOString()),
});

export type DatasetMetadata = z.infer<typeof datasetMetadataSchema>;
