import { detectGpu } from './gpu.util';

describe('GpuUtil', () => {
  it('should detect GPU capabilities without throwing', () => {
    const gpuInfo = detectGpu();
    expect(gpuInfo).toBeDefined();
    expect(typeof gpuInfo.hasGpu).toBe('boolean');
    expect(['cuda', 'metal', 'vulkan', 'cpu']).toContain(gpuInfo.type);
    expect(gpuInfo.details).toBeTruthy();
    expect(gpuInfo.platform).toBeTruthy();
  });
});
