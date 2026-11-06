import type { GroundedChunk, Timings } from '../types/scientific-rag';

export interface AssistantMessageInput {
  content: string;
  citations: string[];
  grounded_chunks: GroundedChunk[];
  timings: Timings;
}

export interface SavedExchange {
  session_id: string;
  user_message_id: string;
  assistant_message_id: string;
}

/** A stored answer, enough to replay the response of an idempotent request. */
export interface StoredExchange {
  session_id: string;
  message_id: string;
  content: string;
  citations: string[];
  grounded_chunks: GroundedChunk[];
  timings: Timings;
}

export type BeginRequestResult =
  | { state: 'started' }
  | { state: 'completed'; session_id: string; message_id: string };

/** What the RAG pipeline needs from chat sessions (implemented by ChatSessionsService). */
export interface SessionStorePort {
  /** The session if it belongs to the user; otherwise 404 `session not found`. */
  assertOwned(sessionId: string, userId: string): Promise<void>;
  /**
   * Stores one question/answer pair. `sessionId` null ➔ a new session titled after the question.
   */
  saveExchange(
    userId: string,
    sessionId: string | null,
    question: string,
    answer: AssistantMessageInput,
    requestKey?: string,
  ): Promise<SavedExchange>;
  /**
   * Reserves an `Idempotency-Key`. A finished request returns where its answer is stored; a running
   * one or another body under the same key ➔ 409.
   */
  beginRequest(
    userId: string,
    key: string,
    fingerprint: string,
  ): Promise<BeginRequestResult>;
  /** Frees the key of a run that failed or was aborted, so the client can retry it. */
  releaseRequest(userId: string, key: string): Promise<void>;
  /** The stored answer of a finished request; 404 if its session is gone. */
  getExchange(
    userId: string,
    sessionId: string,
    messageId: string,
  ): Promise<StoredExchange>;
}

export const SESSION_STORE = Symbol('SESSION_STORE');
