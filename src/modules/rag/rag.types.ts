import type {
  GroundedChunk,
  Quality,
  RagStreamEvent,
  Timings,
} from '../../types/scientific-rag';

/** Events the pipeline yields (errors are thrown, the controller turns them into `error`). */
export type PipelineEvent = Exclude<RagStreamEvent, { type: 'error' }>;

/** Summary of a finished run, for the non-streaming response and the request log. */
export interface PipelineResult {
  answer: string;
  citations: string[];
  grounded_chunks: GroundedChunk[];
  expanded_terms: string[];
  timings: Timings;
  quality?: Quality;
  session_id: string | null;
  message_id: string | null;
  /** The answer comes from an earlier run with the same `Idempotency-Key`. */
  replayed?: boolean;
}
