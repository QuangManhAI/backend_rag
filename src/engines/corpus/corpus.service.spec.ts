import { ServiceUnavailableException } from '@nestjs/common';
import mongoose from 'mongoose';
import { AppConfigService } from '../../config/app-config.service';
import { parseEnv } from '../../config/env.schema';
import { TEST_ENV } from '../../testing/test-app';
import { CORPUS_UNAVAILABLE, CorpusService } from './corpus.service';

describe('CorpusService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const makeService = (corpusUri?: string) => {
    const cfg = new AppConfigService(
      parseEnv({
        ...TEST_ENV,
        MONGO_URI: 'mongodb://127.0.0.1:27017/rag_ts_test',
        CORPUS_MONGO_URI: corpusUri,
      }),
    );
    return new CorpusService(cfg);
  };

  it('skips Mongo connection when CORPUS_MONGO_URI is not configured and returns empty map on hydrate', async () => {
    const createSpy = jest.spyOn(mongoose, 'createConnection');
    const svc = makeService(undefined);
    svc.onModuleInit();
    expect(createSpy).not.toHaveBeenCalled();

    const map = await svc.hydrate([{ chunk_id: 'c1', paper_id: 'p1' }]);
    expect(map.size).toBe(0);
    await expect(svc.onModuleDestroy()).resolves.toBeUndefined();
  });

  it('connects when CORPUS_MONGO_URI is set, checks roles, and hydrates chunks & papers', async () => {
    const chunkDocs = [
      {
        _id: 'c1',
        paper_id: 'p1',
        text: 'LoRA reduces trainable parameters.',
        section_title: 'Method',
        section_type: 'method',
        chunk_index: 2,
      },
      {
        _id: 'c2',
        paper_id: 'p1',
        text: 12345, // non-string text should be skipped
      },
    ];
    const paperDocs = [
      { _id: 'p1', title: 'LoRA', authors: ['Hu', 42, 'Shen'] },
    ];

    const fakeConn = {
      on: jest.fn(),
      asPromise: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      db: {
        admin: () => ({
          command: jest.fn().mockResolvedValue({
            authInfo: { authenticatedUserRoles: [{ role: 'root' }] },
          }),
        }),
      },
      collection: jest.fn((name: string) => ({
        find: jest.fn(() => ({
          toArray: jest
            .fn()
            .mockResolvedValue(name === 'paper_chunks' ? chunkDocs : paperDocs),
        })),
      })),
    };

    jest
      .spyOn(mongoose, 'createConnection')
      .mockReturnValue(fakeConn as unknown as mongoose.Connection);

    const svc = makeService(
      'mongodb://reader:pass@127.0.0.1:27017/rag_ts_corpus',
    );
    svc.onModuleInit();

    const empty = await svc.hydrate([]);
    expect(empty.size).toBe(0);

    const hydrated = await svc.hydrate([
      { chunk_id: 'c1', paper_id: 'p1' },
      { chunk_id: 'c2', paper_id: 'p1' },
    ]);
    expect(hydrated.size).toBe(1);
    expect(hydrated.get('c1')).toEqual({
      text: 'LoRA reduces trainable parameters.',
      section_title: 'Method',
      section_type: 'method',
      chunk_index: 2,
      title: 'LoRA',
      authors: ['Hu', 'Shen'],
    });

    await svc.onModuleDestroy();
    expect(fakeConn.close).toHaveBeenCalledTimes(1);
  });

  it('throws 503 CORPUS_UNAVAILABLE when corpus query fails', async () => {
    const fakeConn = {
      on: jest.fn(),
      asPromise: jest.fn().mockRejectedValue(new Error('timeout')),
      close: jest.fn().mockResolvedValue(undefined),
      db: {
        admin: () => ({
          command: jest.fn().mockRejectedValue(new Error('auth failed')),
        }),
      },
    };
    jest
      .spyOn(mongoose, 'createConnection')
      .mockReturnValue(fakeConn as unknown as mongoose.Connection);

    const svc = makeService(
      'mongodb://reader:pass@127.0.0.1:27017/rag_ts_corpus',
    );
    svc.onModuleInit();

    await expect(
      svc.hydrate([{ chunk_id: 'c1', paper_id: 'p1' }]),
    ).rejects.toThrow(new ServiceUnavailableException(CORPUS_UNAVAILABLE));
  });
});
