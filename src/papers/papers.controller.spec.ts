import { PapersController } from './papers.controller';
import { WorldService } from '../world/world.service';

describe('PapersController Unit Tests', () => {
  let controller: PapersController;
  let mockVectorStore: any;
  let worldService: WorldService;

  beforeEach(() => {
    worldService = new WorldService();
    worldService.onModuleInit();
    mockVectorStore = {
      getPaperChunks: jest.fn(),
    };
    controller = new PapersController(mockVectorStore, worldService);
  });

  it('should return real chunks when found in LanceDB', async () => {
    mockVectorStore.getPaperChunks.mockResolvedValue([
      {
        paper_id: 'real_paper_1',
        title: 'Real Title',
        authors: ['Author A'],
        section_title: 'Method',
        section_type: 'method',
        text: 'Some methodology text',
      },
    ]);

    const res = await controller.getPaper('real_paper_1');
    expect(res.paper_id).toBe('real_paper_1');
    expect(res.title).toBe('Real Title');
    expect(res.chunks.length).toBe(1);
  });

  it('should fall back to worldService when paper not in LanceDB', async () => {
    mockVectorStore.getPaperChunks.mockResolvedValue([]);

    const res = await controller.getPaper('2401.0001');
    expect(res.paper_id).toBe('2401.0001');
    expect(res.title).toBeDefined();
    expect(res.chunks.length).toBeGreaterThan(0);
  });
});
