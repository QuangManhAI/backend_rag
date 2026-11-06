import { AppConfigService } from '../../config/app-config.service';
import { parseEnv } from '../../config/env.schema';
import { TEST_ENV } from '../../testing/test-app';
import {
  JudgeService,
  MAX_ANSWER_CHARS,
  MAX_PENDING,
  type LayaModel,
} from './judge.service';

const config = (extra: Record<string, string> = {}) =>
  new AppConfigService(
    parseEnv({ ...TEST_ENV, MONGO_URI: 'mongodb://x', ...extra }),
  );

class TestJudge extends JudgeService {
  loads = 0;
  constructor(
    c: AppConfigService,
    private readonly fake: LayaModel | Error,
  ) {
    super(c);
  }
  protected loadModel(): Promise<LayaModel> {
    this.loads++;
    return this.fake instanceof Error
      ? Promise.reject(this.fake)
      : Promise.resolve(this.fake);
  }
}

const passage = (text: string) => ({ title: 'T', section_title: 'S', text });

function model(scores: number[]) {
  const systemOne = jest.fn(() =>
    Promise.resolve({ answers: { q: { noul: scores.shift() ?? 0 } } }),
  );
  return { systemOne, close: jest.fn(() => Promise.resolve()) };
}

describe('JudgeService', () => {
  const on = { LAYA_MODEL_DIR: '/m' };

  it('is off without a model dir and never loads', async () => {
    const j = new TestJudge(config(), model([]));
    expect(j.enabled).toBe(false);
    expect(await j.relevance('q', [passage('a')])).toBeNull();
    expect(j.loads).toBe(0);
  });

  it('scores each passage in order and loads once', async () => {
    const m = model([0.2, 0.7]);
    const j = new TestJudge(config(on), m);
    expect(await j.relevance('q', [passage('a'), passage('b')])).toEqual([
      0.2, 0.7,
    ]);
    await j.relevance('q', [passage('c')]);
    expect(j.loads).toBe(1);
    expect(m.systemOne).toHaveBeenCalledTimes(3);
  });

  it('groundedness keeps the best passage and shortens a long answer', async () => {
    const m = model([0.2, 0.7]);
    const j = new TestJudge(config(on), m);
    const score = await j.groundedness('q', 'x'.repeat(5000), [
      passage('a'),
      passage('b'),
    ]);
    expect(score).toBe(0.7);
    const state = (
      m.systemOne.mock.calls as unknown as [{ answer: string }][]
    )[0][0];
    expect(state.answer).toHaveLength(MAX_ANSWER_CHARS);
  });

  it('a model that fails to load gives no verdict', async () => {
    const j = new TestJudge(config(on), new Error('no file'));
    expect(await j.relevance('q', [passage('a')])).toBeNull();
  });

  it('a failing run gives no verdict and the next run still works', async () => {
    const m = model([0.4]);
    m.systemOne.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    const j = new TestJudge(config(on), m);
    expect(await j.relevance('q', [passage('a')])).toBeNull();
    expect(await j.relevance('q', [passage('a')])).toEqual([0.4]);
  });

  it('a run past the deadline gives no verdict', async () => {
    const m = model([]);
    m.systemOne.mockImplementationOnce(
      () => new Promise(() => undefined) as never,
    );
    const j = new TestJudge(config({ ...on, LAYA_TIMEOUT_MS: '100' }), m);
    expect(await j.relevance('q', [passage('a')])).toBeNull();
  });

  it('sheds work beyond the queue limit instead of queueing it', async () => {
    let release = () => undefined as void;
    const gate = new Promise<void>((r) => (release = r));
    const m = {
      systemOne: jest.fn(async () => {
        await gate;
        return { answers: { q: { noul: 0.5 } } };
      }),
      close: () => Promise.resolve(),
    };
    const j = new TestJudge(config(on), m);
    const running = Array.from({ length: MAX_PENDING }, () =>
      j.relevance('q', [passage('a')]),
    );
    expect(await j.relevance('q', [passage('late')])).toBeNull();
    release();
    expect(await Promise.all(running)).toEqual(
      Array.from({ length: MAX_PENDING }, () => [0.5]),
    );
  });
});
