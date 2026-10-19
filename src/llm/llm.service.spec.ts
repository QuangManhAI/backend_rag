import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service';

describe('LlmService', () => {
  let service: LlmService;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'LLM_MODEL_PATH' || key === 'MODEL_PATH') return 'missing/model.gguf';
        if (key === 'GPU_LAYERS') return '99';
        if (key === 'LLM_CONTEXT_SIZE' || key === 'CONTEXT_SIZE') return '2048';
        if (key === 'LLM_SEQUENCES') return '1';
        if (key === 'LLM_MAX_TOKENS') return '64';
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<LlmService>(LlmService);
    configService = module.get(ConfigService);
  });

  afterEach(async () => {
    if (service) {
      await service.onModuleDestroy();
    }
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(service.isReady()).toBe(false);
  });

  describe('Fallback Mode when Model File is Missing', () => {
    it('should enter fallback mode and generate fallback response', async () => {
      await service.onModuleInit();
      expect(service.isReady()).toBe(false);

      const fallbackAnswer = await service.generateGroundedAnswer('system prompt', 'user question');
      expect(fallbackAnswer).toContain('Model in fallback mode');
    });

    it('should return fallback message when context is missing', async () => {
      await service.onModuleInit();
      const res = await service.generateGroundedAnswer('sys', 'query');
      expect(res).toContain('Model in fallback mode');
    });
  });

  describe('Ready Mode Inference (with mocked Llama session)', () => {
    it('should generate grounded answer and stream tokens', async () => {
      const mockSequence = {
        dispose: jest.fn(),
      };
      const mockContext = {
        getSequence: jest.fn().mockReturnValue(mockSequence),
        dispose: jest.fn(),
      };
      const mockModel = {
        dispose: jest.fn(),
      };
      const mockLlama = {
        dispose: jest.fn(),
      };

      const mockChatSession = jest.fn().mockImplementation(() => ({
        prompt: jest.fn().mockImplementation(async (text: string, options: any) => {
          if (options?.onTextChunk) {
            options.onTextChunk('LoRA ');
            options.onTextChunk('adapts weights.');
          }
          return 'LoRA adapts weights.';
        }),
      }));

      (service as any).model = mockModel;
      (service as any).context = mockContext;
      (service as any).llama = mockLlama;
      (service as any).chatSessionClass = mockChatSession;

      expect(service.isReady()).toBe(true);

      const answer = await service.generateGroundedAnswer(
        'system prompt',
        'what is lora?',
      );

      expect(answer).toBe('LoRA adapts weights.');
      expect(mockSequence.dispose).toHaveBeenCalled();
    });
  });

  describe('Error handling & Resource Teardown', () => {
    it('should handle and rethrow errors from session.prompt and dispose sequence', async () => {
      const mockSequence = {
        dispose: jest.fn(),
      };
      const mockContext = {
        getSequence: jest.fn().mockReturnValue(mockSequence),
      };
      const mockChatSession = jest.fn().mockImplementation(() => ({
        prompt: jest.fn().mockRejectedValue(new Error('Inference token limit exceeded')),
      }));

      (service as any).context = mockContext;
      (service as any).chatSessionClass = mockChatSession;

      await expect(service.generateGroundedAnswer('system', 'prompt')).rejects.toThrow(
        'Inference token limit exceeded',
      );
      expect(mockSequence.dispose).toHaveBeenCalled();
    });

    it('should safely dispose native resources on onModuleDestroy', async () => {
      const mockContext = { dispose: jest.fn() };
      const mockModel = { dispose: jest.fn() };
      const mockLlama = { dispose: jest.fn() };

      (service as any).context = mockContext;
      (service as any).model = mockModel;
      (service as any).llama = mockLlama;

      await service.onModuleDestroy();

      expect(mockContext.dispose).toHaveBeenCalled();
      expect(mockModel.dispose).toHaveBeenCalled();
      expect(mockLlama.dispose).toHaveBeenCalled();
      expect(service.isReady()).toBe(false);
    });
  });
});
