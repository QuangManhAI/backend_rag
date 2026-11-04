import { Logger } from '@nestjs/common';
import type { Connection } from 'mongoose';
import type { CorpusReaderService } from '../corpus/corpus-reader.service';
import { AppConfigService } from '../config/app-config.service';
import type { LlmPort } from '../llm/llm.service';
import type { TreeRouterService } from '../tree-router/tree-router.service';
import type { VectorStorePort } from '../vector-store/vector-store.service';
import { HealthController } from './health.controller';
import { Health, HealthService, overallStatus } from './health.service';

/** A non-production config, so the controller returns the detailed payload. */
const config = {
  get: (k: string) => (k === 'NODE_ENV' ? 'test' : undefined),
} as unknown as AppConfigService;

function deps() {
  const state = {
    mongo: true,
    corpus: true,
    qdrant: true,
    llm: true,
    world: false,
  };
  const mongo = {
    get readyState() {
      return state.mongo ? 1 : 0;
    },
    db: { admin: () => ({ ping: () => Promise.resolve({ ok: 1 }) }) },
  } as unknown as Connection;
  const vectors = {
    ping: () => Promise.resolve(state.qdrant),
  } as unknown as VectorStorePort;
  const llm = {
    status: () => ({
      ready: state.llm,
      model_id: 'qwen',
      gpu: 'metal',
      queue_length: 2,
    }),
  } as unknown as LlmPort;
  const router = {
    isLoaded: () => state.world,
    worldVersion: () => null,
  } as unknown as TreeRouterService;
  const corpus = {
    isReady: () => Promise.resolve(state.corpus),
  } as unknown as CorpusReaderService;
  return { state, svc: new HealthService(mongo, vectors, llm, router, corpus) };
}

describe('overallStatus', () => {
  it.each([
    [
      { mongo: true, corpus: true, qdrant: true, llm: true, world: false },
      'ok',
    ],
    [
      { mongo: true, corpus: true, qdrant: true, llm: false, world: true },
      'degraded',
    ],
    [
      { mongo: false, corpus: true, qdrant: true, llm: true, world: true },
      'down',
    ],
    [
      { mongo: true, corpus: true, qdrant: false, llm: false, world: true },
      'down',
    ],
  ])('%j ➔ %s', (c, s) => expect(overallStatus(c)).toBe(s));
});

describe('HealthService', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('reports ok / degraded / down with llm details', async () => {
    const { state, svc } = deps();
    await svc.check();
    expect(await svc.health()).toMatchObject({
      status: 'ok',
      components: {
        mongo: true,
        corpus: true,
        qdrant: true,
        llm: true,
        world: false,
      },
      llm: { model_id: 'qwen', gpu: 'metal', queue_length: 2 },
      world_version: null,
    });
    state.llm = false;
    await svc.check();
    expect((await svc.health()).status).toBe('degraded');
    state.qdrant = false;
    await svc.check();
    expect((await svc.health()).status).toBe('down');
  });

  it('logs HEALTH_CHANGED only when a component really changes', async () => {
    const { state, svc } = deps();
    await svc.check();
    await svc.check();
    expect(warn).not.toHaveBeenCalled();
    state.qdrant = false;
    await svc.check();
    await svc.check();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      { component: 'qdrant', from: 'up', to: 'down' },
      'HEALTH_CHANGED',
    );
    state.qdrant = true;
    await svc.check();
    expect(warn).toHaveBeenLastCalledWith(
      { component: 'qdrant', from: 'down', to: 'up' },
      'HEALTH_CHANGED',
    );
  });

  it('serves the cached result without probing', async () => {
    const { state, svc } = deps();
    await svc.check();
    state.mongo = false; // not probed until the next round
    expect((await svc.health()).status).toBe('ok');
  });

  it('ready ➔ 503 when down, live never touches dependencies', async () => {
    const { state, svc } = deps();
    const ctl = new HealthController(svc, config);
    expect(ctl.live()).toEqual({ status: 'ok' });
    const res = { status: jest.fn() };
    await svc.check();
    await ctl.ready(res as never);
    expect(res.status).not.toHaveBeenCalled();
    state.mongo = false;
    await svc.check();
    const h = (await ctl.ready(res as never)) as Health;
    expect(res.status).toHaveBeenCalledWith(503);
    expect(h.status).toBe('down');
  });

  it('masks the detailed payload in production', async () => {
    const { svc } = deps();
    const prod = new HealthController(svc, config);
    (prod as unknown as { config: AppConfigService }).config = {
      get: (k: string) => (k === 'NODE_ENV' ? 'production' : undefined),
    } as unknown as AppConfigService;
    await svc.check();
    const masked = (await prod.get()) as Record<string, unknown>;
    expect(masked.status).toBeDefined();
    expect(masked).not.toHaveProperty('llm');
    expect(masked).not.toHaveProperty('world_version');
  });
});
