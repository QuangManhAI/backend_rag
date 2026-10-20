import { WorldService } from './world.service';
import { WorldController } from './world.controller';

describe('WorldModule Unit Tests', () => {
  let service: WorldService;
  let controller: WorldController;

  beforeEach(() => {
    service = new WorldService();
    service.onModuleInit();
    controller = new WorldController(service);
  });

  it('should initialize and return categories', () => {
    const cats = controller.getCategories();
    expect(Array.isArray(cats)).toBe(true);
    expect(cats.length).toBe(10);
  });

  it('should return ground layout with crates and roots', () => {
    const ground = controller.getGround();
    expect(ground.tile_size).toBe(3);
    expect(ground.crates.length).toBeGreaterThan(0);
    expect(ground.roots.length).toBeGreaterThan(0);
  });

  it('should return tree hierarchy nodes', () => {
    const tree = controller.getTree();
    expect(tree.length).toBeGreaterThan(1);
    expect(tree[0].id).toBe(0);
  });

  it('should return vectors buffer and vector ids', () => {
    const ids = controller.getVectorIds();
    expect(ids.length).toBe(30000);

    const mockRes: any = {
      headers: {},
      setHeader(k: string, v: string) {
        this.headers[k] = v;
      },
      send: jest.fn(),
    };
    controller.getVectorsBin(mockRes);
    expect(mockRes.headers['Content-Type']).toBe('application/octet-stream');
    expect(mockRes.send).toHaveBeenCalled();
  });

  it('should return paper details for given ID', () => {
    const detail = service.getPaperDetail('2401.0001');
    expect(detail.paper_id).toBe('2401.0001');
    expect(detail.title).toBeDefined();
    expect(detail.chunks.length).toBeGreaterThan(0);
  });
});
