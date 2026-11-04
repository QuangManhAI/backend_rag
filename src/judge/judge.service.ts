import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { resolve } from 'path';
import { AppConfigService } from '../config/app-config.service';

/** The part of a chunk the judge reads. */
export interface JudgedPassage {
  title: string;
  section_title: string;
  text: string;
}

/**
 * Decisions around the LLM (the "Jev + RAG" pipeline, run with Laya). Every method returns null
 * instead of throwing: a judge that is off, overloaded or failing must not take the chat down.
 */
export interface JudgePort {
  readonly enabled: boolean;
  /** P(the passage directly answers the question), one per passage, in input order. */
  relevance(
    question: string,
    passages: JudgedPassage[],
  ): Promise<number[] | null>;
  /** Best P(the answer is supported by the passage) over the passages. */
  groundedness(
    question: string,
    answer: string,
    passages: JudgedPassage[],
  ): Promise<number | null>;
}

export const JUDGE_PORT = Symbol('JUDGE_PORT');

/** The subset of `@receptron/laya` used here (faked in tests). */
export interface LayaModel {
  systemOne(
    state: Record<string, string>,
    questions: { q: { type: 'noul'; instructions: string } },
  ): Promise<{ answers: { q: { noul: number } } }>;
  close(): Promise<void>;
}

export const RELEVANCE_QUESTION =
  'Does the passage directly answer the question? True only if the passage states the answer. ' +
  'False if it merely shares words or the topic without answering.';

export const GROUNDEDNESS_QUESTION =
  'Is the answer supported by the evidence passage? True only if the claims in the answer are ' +
  'stated in the evidence. False if the answer adds facts the evidence does not contain.';

/** Laya reads 512 tokens: a long answer would push the evidence out of the window. */
export const MAX_ANSWER_CHARS = 900;
export const MAX_PASSAGE_CHARS = 1100;
/** Requests beyond this are skipped rather than queued: the chat stays up under load. */
export const MAX_PENDING = 8;

const passageOf = (p: JudgedPassage, max?: number): string => {
  const head = [p.title, p.section_title].filter(Boolean).join(' — ');
  const text = max ? p.text.slice(0, max) : p.text;
  return head ? `${head}\n${text}` : text;
};

/** Runs Laya in-process through ONNX Runtime; one job at a time, since one run uses every core. */
@Injectable()
export class JudgeService implements JudgePort, OnModuleDestroy {
  private readonly logger = new Logger(JudgeService.name);
  private loading: Promise<LayaModel | null> | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;

  constructor(private readonly config: AppConfigService) {}

  get enabled(): boolean {
    return Boolean(this.config.get('LAYA_MODEL_DIR'));
  }

  async relevance(
    question: string,
    passages: JudgedPassage[],
  ): Promise<number[] | null> {
    if (!passages.length) return [];
    return this.job((m) =>
      this.eachIn(m, passages, RELEVANCE_QUESTION, (p) => ({
        question,
        passage: passageOf(p),
      })),
    );
  }

  async groundedness(
    question: string,
    answer: string,
    passages: JudgedPassage[],
  ): Promise<number | null> {
    if (!passages.length) return 0;
    const scores = await this.job((m) =>
      this.eachIn(m, passages, GROUNDEDNESS_QUESTION, (p) => ({
        question,
        answer: answer.slice(0, MAX_ANSWER_CHARS),
        evidence: passageOf(p, MAX_PASSAGE_CHARS),
      })),
    );
    return scores ? Math.max(...scores) : null;
  }

  async onModuleDestroy(): Promise<void> {
    const model = await this.loading;
    await model?.close().catch(() => undefined);
  }

  /** Overridden in tests. */
  protected async loadModel(dir: string): Promise<LayaModel> {
    const { Laya } = await import('@receptron/laya');
    return Laya.load({
      modelDir: resolve(dir),
    });
  }

  private async eachIn(
    model: LayaModel,
    passages: JudgedPassage[],
    instructions: string,
    state: (p: JudgedPassage) => Record<string, string>,
  ): Promise<number[]> {
    const out: number[] = [];
    // One state per call, so the batching of `systemOne` (one state, many questions) cannot help.
    for (const p of passages) {
      const r = await model.systemOne(state(p), {
        q: { type: 'noul', instructions },
      });
      out.push(r.answers.q.noul);
    }
    return out;
  }

  /** Serial queue with a cap and a deadline; any problem means "no verdict" (null). */
  private async job<T>(
    work: (model: LayaModel) => Promise<T>,
  ): Promise<T | null> {
    const dir = this.config.get('LAYA_MODEL_DIR');
    if (!dir) return null;
    if (this.pending >= MAX_PENDING) {
      this.logger.warn({ pending: this.pending }, 'JUDGE_OVERLOADED: skipped');
      return null;
    }
    this.pending++;
    const run = this.tail.then(async () => {
      const model = await this.model(dir);
      return model ? work(model) : null;
    });
    this.tail = run.catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        run,
        new Promise<null>((res) => {
          timer = setTimeout(() => {
            this.logger.warn('JUDGE_TIMEOUT: skipped');
            res(null);
          }, this.config.get('LAYA_TIMEOUT_MS'));
        }),
      ]);
    } catch (e) {
      this.logger.warn({ err: e }, 'JUDGE_FAILED: skipped');
      return null;
    } finally {
      clearTimeout(timer);
      void run
        .catch(() => undefined)
        .finally(() => {
          this.pending--;
        });
    }
  }

  private model(dir: string): Promise<LayaModel | null> {
    this.loading ??= this.loadModel(dir).catch((e: unknown) => {
      this.logger.error({ err: e }, 'JUDGE_LOAD_FAILED');
      this.loading = null;
      return null;
    });
    return this.loading;
  }
}
