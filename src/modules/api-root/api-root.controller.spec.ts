import { ApiRootController } from './api-root.controller';

describe('ApiRootController', () => {
  it('returns API metadata and top-level HATEOAS links', () => {
    const ctrl = new ApiRootController();
    const res = ctrl.root();
    expect(res.name).toBe('RAG_TS API');
    expect(res.version).toBe('v1');
    expect(res._links).toBeDefined();
    expect(res._links.health).toBeDefined();
  });
});
