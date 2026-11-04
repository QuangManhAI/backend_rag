import { Module } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';
import { AppConfigService } from '../config/app-config.service';
import { CorpusModule } from '../corpus/corpus.module';
import {
  QDRANT_CLIENT,
  QDRANT_TIMEOUT_MS,
  VECTOR_STORE_PORT,
  VectorStoreService,
} from './vector-store.service';

@Module({
  imports: [CorpusModule],
  providers: [
    {
      provide: QDRANT_CLIENT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const url = config.get('QDRANT_URL');
        let port: number | undefined;
        try {
          const parsed = new URL(url);
          port = parsed.port
            ? Number(parsed.port)
            : parsed.protocol === 'https:'
              ? 443
              : 6333;
        } catch {
          port = undefined;
        }
        return new QdrantClient({
          url,
          port,
          apiKey: config.get('QDRANT_API_KEY') || undefined,
          timeout: QDRANT_TIMEOUT_MS,
          checkCompatibility: false,
        });
      },
    },
    VectorStoreService,
    { provide: VECTOR_STORE_PORT, useExisting: VectorStoreService },
  ],
  exports: [VECTOR_STORE_PORT],
})
export class VectorStoreModule {}
