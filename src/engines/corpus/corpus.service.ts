import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import mongoose, { type Connection } from 'mongoose';
import { AppConfigService } from '../../config/app-config.service';

export const CORPUS_UNAVAILABLE = 'corpus unavailable';
export const CORPUS_DB = 'rag_ts_corpus';
export const CORPUS_TIMEOUT_MS = 5000;

/** What a Qdrant point no longer carries; MongoDB `rag_ts_corpus` is its source of truth. */
export interface ChunkContent {
  text: string;
  section_title: string;
  section_type: string;
  chunk_index?: number;
  title: string;
  authors: string[];
}

export interface ChunkRef {
  chunk_id: string;
  paper_id: string;
}

export interface CorpusPort {
  /** Content of the given chunks by `chunk_id`; a chunk not synced yet is simply absent. */
  hydrate(refs: ChunkRef[]): Promise<Map<string, ChunkContent>>;
}

export const CORPUS_PORT = Symbol('CORPUS_PORT');

interface ChunkDoc {
  _id: string;
  paper_id: string;
  text?: unknown;
  section_title?: unknown;
  section_type?: unknown;
  chunk_index?: unknown;
}

interface PaperDoc {
  _id: string;
  title?: unknown;
  authors?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Roles that are more than the read access this service needs (D-056). */
const OVERPRIVILEGED = new Set(['root', 'dbOwner', 'userAdminAnyDatabase']);

/** Read-only access to `rag_ts_corpus`, on its own connection: never written from the app. */
@Injectable()
export class CorpusService
  implements CorpusPort, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CorpusService.name);
  private conn: Connection | null = null;

  constructor(private readonly config: AppConfigService) {}

  onModuleInit(): void {
    const uri = this.config.get('CORPUS_MONGO_URI');
    if (!uri) {
      this.logger.warn(
        'CORPUS_NOT_CONFIGURED: chunks without text in Qdrant are skipped',
      );
      return;
    }
    this.conn = mongoose.createConnection(uri, {
      dbName: CORPUS_DB,
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 20,
      readPreference: 'secondaryPreferred',
    });
    // Connects in the background: a corpus outage must not stop the app from booting.
    this.conn.on('error', (e: unknown) => {
      this.logger.warn({ err: e }, 'CORPUS_CONNECTION_ERROR');
    });
    void this.checkRoles(this.conn);
  }

  async onModuleDestroy(): Promise<void> {
    await this.conn?.close().catch(() => undefined);
  }

  async hydrate(refs: ChunkRef[]): Promise<Map<string, ChunkContent>> {
    const out = new Map<string, ChunkContent>();
    if (!refs.length || !this.conn) return out;
    const chunkIds = [...new Set(refs.map((r) => r.chunk_id))];
    const paperIds = [...new Set(refs.map((r) => r.paper_id))];
    try {
      await this.conn.asPromise();
      const [chunks, papers] = await Promise.all([
        this.conn
          .collection<ChunkDoc>('paper_chunks')
          .find(
            { _id: { $in: chunkIds } },
            {
              projection: {
                paper_id: 1,
                text: 1,
                section_title: 1,
                section_type: 1,
                chunk_index: 1,
              },
              maxTimeMS: CORPUS_TIMEOUT_MS,
            },
          )
          .toArray(),
        this.conn
          .collection<PaperDoc>('papers')
          .find(
            { _id: { $in: paperIds } },
            {
              projection: { title: 1, authors: 1 },
              maxTimeMS: CORPUS_TIMEOUT_MS,
            },
          )
          .toArray(),
      ]);
      const byPaper = new Map(papers.map((p) => [p._id, p]));
      for (const c of chunks) {
        if (typeof c.text !== 'string') continue;
        const paper = byPaper.get(c.paper_id);
        out.set(c._id, {
          text: c.text,
          section_title: str(c.section_title),
          section_type: str(c.section_type) || 'other',
          ...(typeof c.chunk_index === 'number'
            ? { chunk_index: c.chunk_index }
            : {}),
          title: str(paper?.title),
          authors: Array.isArray(paper?.authors)
            ? paper.authors.filter((a): a is string => typeof a === 'string')
            : [],
        });
      }
      return out;
    } catch (e) {
      this.logger.warn({ err: e }, 'CORPUS_CALL_FAILED');
      throw new ServiceUnavailableException(CORPUS_UNAVAILABLE);
    }
  }

  private async checkRoles(conn: Connection): Promise<void> {
    try {
      await conn.asPromise();
      const status = (await conn.db?.admin().command({
        connectionStatus: 1,
      })) as
        | { authInfo?: { authenticatedUserRoles?: Array<{ role: string }> } }
        | undefined;
      const roles = status?.authInfo?.authenticatedUserRoles ?? [];
      const excess = roles
        .map((r) => r.role)
        .filter((r) => OVERPRIVILEGED.has(r));
      if (excess.length) {
        this.logger.warn(
          { roles: excess },
          'CORPUS_OVERPRIVILEGED: use an account with only read on rag_ts_corpus',
        );
      }
    } catch (e) {
      this.logger.warn({ err: e }, 'CORPUS_ROLE_CHECK_FAILED');
    }
  }
}
