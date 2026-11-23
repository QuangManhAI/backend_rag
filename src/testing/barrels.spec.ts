import * as common from '../common';
import * as commonHttp from '../common/http';
import * as commonLogging from '../common/logging';
import * as commonMetrics from '../common/metrics';
import * as commonPagination from '../common/pagination';
import * as commonSecurity from '../common/security';
import * as commonUtils from '../common/utils';
import * as config from '../config';
import * as engines from '../engines';
import * as corpus from '../engines/corpus';
import * as embedding from '../engines/embedding';
import * as judge from '../engines/judge';
import * as llm from '../engines/llm';
import * as mining from '../engines/mining';
import * as treeRouter from '../engines/tree-router';
import * as vectorStore from '../engines/vector-store';
import * as modules from '../modules';
import * as admin from '../modules/admin';
import * as adminDecorators from '../modules/admin/decorators';
import * as adminDto from '../modules/admin/dto';
import * as adminRepositories from '../modules/admin/repositories';
import * as adminSchemas from '../modules/admin/schemas';
import * as apiRoot from '../modules/api-root';
import * as auth from '../modules/auth';
import * as authDecorators from '../modules/auth/decorators';
import * as authDto from '../modules/auth/dto';
import * as authGuards from '../modules/auth/guards';
import * as authRepositories from '../modules/auth/repositories';
import * as authSchemas from '../modules/auth/schemas';
import * as chatSessions from '../modules/chat-sessions';
import * as chatSessionsDto from '../modules/chat-sessions/dto';
import * as chatSessionsRepositories from '../modules/chat-sessions/repositories';
import * as chatSessionsSchemas from '../modules/chat-sessions/schemas';
import * as health from '../modules/health';
import * as healthDto from '../modules/health/dto';
import * as papers from '../modules/papers';
import * as papersDto from '../modules/papers/dto';
import * as rag from '../modules/rag';
import * as ragDto from '../modules/rag/dto';
import * as ragPipeline from '../modules/rag/pipeline';
import * as ragTransport from '../modules/rag/transport';
import * as testing from '../testing';
import * as types from '../types';

describe('Backend barrel exports', () => {
  it('resolves all public barrel indexes without circular-import undefined exports', () => {
    const barrels = [
      common,
      commonHttp,
      commonLogging,
      commonMetrics,
      commonPagination,
      commonSecurity,
      commonUtils,
      config,
      engines,
      corpus,
      embedding,
      judge,
      llm,
      mining,
      treeRouter,
      vectorStore,
      modules,
      admin,
      adminDecorators,
      adminDto,
      adminRepositories,
      adminSchemas,
      apiRoot,
      auth,
      authDecorators,
      authDto,
      authGuards,
      authRepositories,
      authSchemas,
      chatSessions,
      chatSessionsDto,
      chatSessionsRepositories,
      chatSessionsSchemas,
      health,
      healthDto,
      papers,
      papersDto,
      rag,
      ragDto,
      ragPipeline,
      ragTransport,
      testing,
      types,
    ];
    for (const mod of barrels) {
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    }
    expect(common.HttpExceptionFilter).toBeDefined();
    expect(modules.RagModule).toBeDefined();
    expect(engines.LlmModule).toBeDefined();
    expect(types.toSectionType).toBeDefined();
  });
});
