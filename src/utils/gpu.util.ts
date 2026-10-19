import { execSync } from 'child_process';
import * as os from 'os';
import { Logger } from '@nestjs/common';

export interface GpuInfo {
  hasGpu: boolean;
  type: 'cuda' | 'metal' | 'vulkan' | 'cpu';
  platform: string;
  arch: string;
  details: string;
  nodeLlamaGpuOption: 'auto' | 'cuda' | 'metal' | 'vulkan' | false;
}

const logger = new Logger('GpuDetector');

function parseConfiguredGpuOption(): 'auto' | 'cuda' | 'metal' | 'vulkan' | false {
  const envOption = process.env.LLM_GPU?.trim().toLowerCase();
  if (envOption === 'false' || envOption === 'none' || envOption === 'cpu') {
    return false;
  }
  if (envOption === 'cuda' || envOption === 'metal' || envOption === 'vulkan' || envOption === 'auto') {
    return envOption;
  }
  return 'auto';
}

/**
 * Detect GPU capabilities across Windows (NVIDIA CUDA, Intel Arc, AMD Vulkan), macOS (Apple Silicon Metal), and Linux.
 */
export function detectGpu(): GpuInfo {
  const platform = os.platform();
  const arch = os.arch();
  const configuredGpu = parseConfiguredGpuOption();

  // If user explicitly forced CPU
  if (configuredGpu === false) {
    logger.log('LLM_GPU explicitly configured as CPU/false. Disabling GPU acceleration.');
    return {
      hasGpu: false,
      type: 'cpu',
      platform,
      arch,
      details: 'CPU Only (configured by LLM_GPU=false)',
      nodeLlamaGpuOption: false,
    };
  }

  // 1. Apple Silicon (macOS Metal / MPS)
  if (platform === 'darwin') {
    if (arch === 'arm64') {
      logger.log('Detected Apple Silicon (M-series). Enabling Metal GPU acceleration.');
      return {
        hasGpu: true,
        type: 'metal',
        platform,
        arch,
        details: 'Apple Silicon Metal/MPS GPU Acceleration',
        nodeLlamaGpuOption: configuredGpu === 'auto' ? 'metal' : configuredGpu,
      };
    } else {
      logger.log('Detected Intel Mac. Checking for external GPU or fallback to CPU.');
      return {
        hasGpu: false,
        type: 'cpu',
        platform,
        arch,
        details: 'Intel Mac - CPU fallback',
        nodeLlamaGpuOption: configuredGpu,
      };
    }
  }

  // 2. Windows or Linux: Check for NVIDIA CUDA
  if (platform === 'win32' || platform === 'linux') {
    try {
      const output = execSync('nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 3000,
      }).trim();

      if (output && output.length > 0) {
        logger.log(`Detected NVIDIA GPU via nvidia-smi: ${output}. Enabling CUDA.`);
        return {
          hasGpu: true,
          type: 'cuda',
          platform,
          arch,
          details: `NVIDIA CUDA (${output})`,
          nodeLlamaGpuOption: configuredGpu === 'auto' ? 'cuda' : configuredGpu,
        };
      }
    } catch {
      // nvidia-smi failed or not installed
    }
  }

  // 3. Windows: Check for Intel Arc / AMD Radeon / Other GPUs via PowerShell
  if (platform === 'win32') {
    try {
      const gpuNames = execSync(
        'powershell -NoProfile -Command "(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join \', \'"',
        {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
          timeout: 4000,
        },
      ).trim();

      if (gpuNames && gpuNames.length > 0) {
        logger.log(`Detected Windows Display Adapter: ${gpuNames}. Enabling Vulkan/Auto GPU acceleration.`);
        return {
          hasGpu: true,
          type: configuredGpu === 'auto' ? 'vulkan' : (configuredGpu as 'vulkan' | 'cuda' | 'metal' | 'cpu'),
          platform,
          arch,
          details: `${gpuNames} (Vulkan Hardware Acceleration)`,
          nodeLlamaGpuOption: configuredGpu,
        };
      }
    } catch {
      // PowerShell GPU query failed
    }
  }

  // 4. Fallback: let node-llama-cpp try auto-detection with Vulkan/CPU
  logger.warn('No dedicated GPU detected via system query. Delegating to node-llama-cpp auto-detection.');
  return {
    hasGpu: false,
    type: 'cpu',
    platform,
    arch,
    details: 'Auto-detecting GPU backend via node-llama-cpp',
    nodeLlamaGpuOption: configuredGpu,
  };
}

/**
 * Updates GpuInfo based on the actual active backend reported by node-llama-cpp instance.
 */
export function updateGpuInfoFromLlama(
  currentInfo: GpuInfo,
  activeBackend: string | false | null | undefined,
  gpuLayers: number,
): GpuInfo {
  if (activeBackend && typeof activeBackend === 'string' && activeBackend !== 'false') {
    const backendType = activeBackend.toLowerCase() as 'cuda' | 'metal' | 'vulkan' | 'cpu';
    const gpuOption: 'cuda' | 'metal' | 'vulkan' | false = backendType === 'cpu' ? false : (backendType as 'cuda' | 'metal' | 'vulkan');
    return {
      ...currentInfo,
      hasGpu: true,
      type: backendType,
      details: `${currentInfo.details ? currentInfo.details.split(' - ')[0] : 'Hardware GPU'}: Active backend ${activeBackend.toUpperCase()} with ${gpuLayers} layers offloaded`,
      nodeLlamaGpuOption: gpuOption,
    };
  }

  return {
    ...currentInfo,
    hasGpu: false,
    type: 'cpu',
    details: 'CPU Only (node-llama-cpp running in CPU mode)',
    nodeLlamaGpuOption: false,
  };
}
