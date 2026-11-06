import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { readFileSync } from 'fs';
import { Connection, ConnectionStates } from 'mongoose';
import { join } from 'path';
import { LLM_PORT, type LlmPort } from '../llm/llm.service';
import { TreeRouterService } from '../tree-router/tree-router.service';
import {
  VECTOR_STORE_PORT,
  type VectorStorePort,
} from '../vector-store/vector-store.service';

export const CHECK_INTERVAL_MS = 10_000;
const MONGO_PING_TIMEOUT_MS = 2000;

export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface Components {
  mongo: boolean;
  qdrant: boolean;
  llm: boolean;
  world: boolean;
}

export interface Health {
  status: HealthStatus;
  version: string;
  uptime_s: number;
  world_version: string | null;
  components: Components;
  llm: { model_id: string; gpu: string; queue_length: number };
}

/** down: Mongo or Qdrant is dead · degraded: only the LLM is · ok: all serve. */
export function overallStatus(c: Components): HealthStatus {
  if (!c.mongo || !c.qdrant) return 'down';
  if (!c.llm) return 'degraded';
  return 'ok';
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'),
    ) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Probes dependencies every 10 s; requests read the last result, never the dependencies. */
@Injectable()
export class HealthService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(HealthService.name);
  private readonly version = readVersion();
  private last: Components | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<Components> | null = null;

  constructor(
    @InjectConnection() private readonly mongo: Connection,
    @Inject(VECTOR_STORE_PORT) private readonly vectors: VectorStorePort,
    @Inject(LLM_PORT) private readonly llm: LlmPort,
    private readonly router: TreeRouterService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.check();
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Runs one probe round (concurrent callers share it) and logs components that changed. */
  check(): Promise<Components> {
    this.running ??= this.probe()
      .then((next) => {
        const prev = this.last;
        if (prev) {
          for (const k of Object.keys(next) as Array<keyof Components>) {
            if (prev[k] !== next[k]) {
              this.logger.warn(
                {
                  component: k,
                  from: prev[k] ? 'up' : 'down',
                  to: next[k] ? 'up' : 'down',
                },
                'HEALTH_CHANGED',
              );
            }
          }
        }
        this.last = next;
        return next;
      })
      .finally(() => (this.running = null));
    return this.running;
  }

  async health(): Promise<Health> {
    const components = this.last ?? (await this.check());
    const s = this.llm.status();
    return {
      status: overallStatus(components),
      version: this.version,
      uptime_s: Math.floor(process.uptime()),
      world_version: this.router.worldVersion(),
      components,
      llm: { model_id: s.model_id, gpu: s.gpu, queue_length: s.queue_length },
    };
  }

  private async probe(): Promise<Components> {
    const [mongo, qdrant] = await Promise.all([
      this.pingMongo(),
      this.vectors.ping(),
    ]);
    return {
      mongo,
      qdrant,
      llm: this.llm.status().ready,
      world: this.router.isLoaded(),
    };
  }

  private async pingMongo(): Promise<boolean> {
    const db = this.mongo.db;
    if (this.mongo.readyState !== ConnectionStates.connected || !db)
      return false;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        db.admin().ping(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('mongo ping timeout')),
            MONGO_PING_TIMEOUT_MS,
          );
        }),
      ]);
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
