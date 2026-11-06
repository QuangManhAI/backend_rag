import type {
  DynamicModule,
  INestApplication,
  Provider,
  Type,
} from '@nestjs/common';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import type { Server } from 'http';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';
import { configureApp } from '../app.setup';
import { User } from '../modules/auth/schemas/user.schema';
import { LoggerModule } from '../common/logging/logger.module';
import { AppConfigModule } from '../config/app-config.service';

export const TEST_ENV = {
  NODE_ENV: 'test',
  QDRANT_URL: 'http://127.0.0.1:1',
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef',
  JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef',
  MODEL_PATH: '/nonexistent/model.gguf',
  WORLD_DATA_DIR: '/nonexistent/world',
  MINING_DIR: '/nonexistent/mining',
};

/** In-memory single-node replica set (transactions work like in docker compose). */
export async function startMongo(): Promise<MongoMemoryReplSet> {
  return MongoMemoryReplSet.create({ replSet: { count: 1 } });
}

/**
 * The hash of `SEED_PASSWORD`, computed once per test process.
 *
 * The account must carry a real Argon2id hash: `AuthService.login` verifies the password before it
 * looks at `is_active`, and an invalid hash would make `argon2.verify` throw (500) instead of
 * returning 401.
 */
let seedHashPromise: Promise<string> | null = null;

export const SEED_PASSWORD = 'seed password 123';

function seedHash(): Promise<string> {
  seedHashPromise ??= argon2.hash(SEED_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
  return seedHashPromise;
}

/**
 * Creates a real `users` document for a test.
 *
 * The JWT guards look the account up in MongoDB on every request (prompt_security S3), so a test
 * that issues a token must also seed the account it belongs to.
 */
export async function seedUser(
  app: INestApplication,
  id: string,
  roles: ('user' | 'admin')[] = ['user'],
): Promise<void> {
  const users = app.get<Model<User>>(getModelToken(User.name));
  await users.updateOne(
    { _id: new Types.ObjectId(id) },
    {
      $set: {
        email: `${id}@example.com`,
        display_name: 'Test User',
        roles,
        is_active: true,
        token_version: 0,
        password_hash: await seedHash(),
      },
      $setOnInsert: { created_at: new Date() },
    },
    { upsert: true },
  );
}

export interface TestApp {
  app: INestApplication;
  server: () => Server;
  close: () => Promise<void>;
}

export interface TestAppOptions {
  imports: Array<Type | DynamicModule>;
  overrides?: Array<{ provide: Type | string | symbol; useValue: unknown }>;
  providers?: Provider[];
  controllers?: Type[];
}

/** Boots the given feature modules with the real config, logger, filter and validation pipe. */
export async function createTestApp(
  mongo: MongoMemoryReplSet,
  opts: TestAppOptions,
): Promise<TestApp> {
  Object.assign(process.env, TEST_ENV, {
    MONGO_URI: mongo.getUri('rag_ts_test'),
  });
  let builder = Test.createTestingModule({
    imports: [
      AppConfigModule,
      LoggerModule,
      MongooseModule.forRoot(mongo.getUri('rag_ts_test')),
      ...opts.imports,
    ],
    providers: opts.providers ?? [],
    controllers: opts.controllers ?? [],
  });
  for (const o of opts.overrides ?? []) {
    builder = builder.overrideProvider(o.provide).useValue(o.useValue);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return {
    app,
    server: () => app.getHttpServer() as Server,
    close: () => app.close(),
  };
}
