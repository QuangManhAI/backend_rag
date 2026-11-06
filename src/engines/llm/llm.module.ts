import { Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { LLM_ENGINE, NodeLlamaEngine } from './llm-engine';
import { LLM_PORT, LlmService } from './llm.service';

@Module({
  providers: [
    {
      provide: LLM_ENGINE,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new NodeLlamaEngine({
          modelPath: config.get('MODEL_PATH'),
          gpu: config.get('LLM_GPU'),
          sequences: config.get('LLM_CONCURRENCY'),
        }),
    },
    LlmService,
    { provide: LLM_PORT, useExisting: LlmService },
  ],
  exports: [LLM_PORT],
})
export class LlmModule {}
