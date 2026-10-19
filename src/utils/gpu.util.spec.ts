import * as os from 'os';
import * as child_process from 'child_process';

jest.mock('os', () => {
  const actual = jest.requireActual('os');
  return {
    ...actual,
    platform: jest.fn(),
    arch: jest.fn(),
  };
});

jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return {
    ...actual,
    execSync: jest.fn(),
  };
});

import { detectGpu } from './gpu.util';

describe('GpuUtil', () => {
  beforeEach(() => {
    (os.platform as unknown as jest.Mock).mockReturnValue(process.platform);
    (os.arch as unknown as jest.Mock).mockReturnValue(process.arch);
    (child_process.execSync as unknown as jest.Mock).mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should detect GPU capabilities on the host system without throwing', () => {
    const gpuInfo = detectGpu();
    expect(gpuInfo).toBeDefined();
    expect(typeof gpuInfo.hasGpu).toBe('boolean');
    expect(['cuda', 'metal', 'vulkan', 'cpu']).toContain(gpuInfo.type);
    expect(gpuInfo.details).toBeTruthy();
    expect(gpuInfo.platform).toBeTruthy();
  });

  describe('Apple Silicon Metal Detection (darwin)', () => {
    it('should detect Apple Silicon Metal when platform is darwin and arch is arm64', () => {
      (os.platform as unknown as jest.Mock).mockReturnValue('darwin');
      (os.arch as unknown as jest.Mock).mockReturnValue('arm64');

      const info = detectGpu();
      expect(info.hasGpu).toBe(true);
      expect(info.type).toBe('metal');
      expect(info.nodeLlamaGpuOption).toBe('metal');
      expect(info.details).toContain('Apple Silicon Metal/MPS');
    });

    it('should fallback to CPU on Intel Mac (darwin x64)', () => {
      (os.platform as unknown as jest.Mock).mockReturnValue('darwin');
      (os.arch as unknown as jest.Mock).mockReturnValue('x64');

      const info = detectGpu();
      expect(info.hasGpu).toBe(false);
      expect(info.type).toBe('cpu');
      expect(info.nodeLlamaGpuOption).toBe('auto');
      expect(info.details).toContain('Intel Mac - CPU fallback');
    });
  });

  describe('NVIDIA CUDA Detection (win32 / linux)', () => {
    it('should detect NVIDIA CUDA GPU when nvidia-smi succeeds with GPU info', () => {
      (os.platform as unknown as jest.Mock).mockReturnValue('win32');
      (os.arch as unknown as jest.Mock).mockReturnValue('x64');
      (child_process.execSync as unknown as jest.Mock).mockReturnValue(
        'NVIDIA GeForce RTX 4060 Laptop GPU, 581.80, 8188 MiB\n',
      );

      const info = detectGpu();
      expect(info.hasGpu).toBe(true);
      expect(info.type).toBe('cuda');
      expect(info.nodeLlamaGpuOption).toBe('cuda');
      expect(info.details).toContain('NVIDIA CUDA (NVIDIA GeForce RTX 4060 Laptop GPU');
    });

    it('should fallback to CPU when nvidia-smi returns empty string', () => {
      (os.platform as unknown as jest.Mock).mockReturnValue('linux');
      (os.arch as unknown as jest.Mock).mockReturnValue('x64');
      (child_process.execSync as unknown as jest.Mock).mockReturnValue('');

      const info = detectGpu();
      expect(info.hasGpu).toBe(false);
      expect(info.type).toBe('cpu');
      expect(info.nodeLlamaGpuOption).toBe('auto');
      expect(info.details).toContain('CPU Only (No dedicated CUDA/Metal detected)');
    });

    it('should fallback to CPU when nvidia-smi command throws (no driver/GPU)', () => {
      (os.platform as unknown as jest.Mock).mockReturnValue('win32');
      (os.arch as unknown as jest.Mock).mockReturnValue('x64');
      (child_process.execSync as unknown as jest.Mock).mockImplementation(() => {
        throw new Error('command not found: nvidia-smi');
      });

      const info = detectGpu();
      expect(info.hasGpu).toBe(false);
      expect(info.type).toBe('cpu');
      expect(info.nodeLlamaGpuOption).toBe('auto');
      expect(info.details).toContain('CPU Only (No dedicated CUDA/Metal detected)');
    });
  });

  describe('Unsupported or Unknown Platforms', () => {
    it('should fallback to CPU on unsupported platform', () => {
      (os.platform as unknown as jest.Mock).mockReturnValue('sunos');
      (os.arch as unknown as jest.Mock).mockReturnValue('x64');

      const info = detectGpu();
      expect(info.hasGpu).toBe(false);
      expect(info.type).toBe('cpu');
      expect(info.nodeLlamaGpuOption).toBe('auto');
      expect(info.details).toContain('CPU Only (No dedicated CUDA/Metal detected)');
    });
  });
});
