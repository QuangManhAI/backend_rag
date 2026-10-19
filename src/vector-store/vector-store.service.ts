import { Injectable, OnModuleInit, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as lancedb from '@lancedb/lancedb';
import * as path from 'path';
import * as fs from 'fs';
import { ScientificChunk } from '../types/scientific-rag';

@Injectable()
export class VectorStoreService implements OnModuleInit {
  private readonly logger = new Logger(VectorStoreService.name);
  private db: lancedb.Connection | null = null;
  private table: lancedb.Table | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.initLanceDb();
    } catch (error) {
      this.logger.warn(
        `Failed to initialize LanceDB during startup: ${(error as Error).message}. Will retry on search.`,
      );
    }
  }

  private async initLanceDb(): Promise<void> {
    const tableName =
      this.configService.get<string>('LANCEDB_TABLE') || 'scientific_papers_gold';

    const localCandidates = [
      path.resolve(process.cwd(), '../data/gold/lancedb'),
      path.resolve(process.cwd(), 'data/gold/lancedb'),
      'C:\\document\\Study documents\\Uth-Data-Mining\\data\\gold\\lancedb',
    ];

    let targetUri: string | null = null;
    let isS3 = false;

    // Check for local optimized table first unless FORCE_REMOTE_LANCEDB is explicitly set
    if (this.configService.get<string>('FORCE_REMOTE_LANCEDB') !== 'true') {
      for (const candidate of localCandidates) {
        if (
          fs.existsSync(path.join(candidate, `${tableName}.lance`)) ||
          fs.existsSync(path.join(candidate, tableName))
        ) {
          targetUri = candidate;
          break;
        }
      }
    }

    if (!targetUri) {
      targetUri =
        this.configService.get<string>('LANCEDB_URI') ||
        this.configService.get<string>('LANCEDB_PATH') ||
        '../data/gold/lancedb';
      isS3 = targetUri.startsWith('s3://');
    }

    this.logger.log(`Connecting to LanceDB at: ${targetUri}, table: ${tableName}`);

    if (isS3) {
      const awsEndpoint = this.configService.get<string>('R2_ENDPOINT_URL');
      const awsAccessKeyId = this.configService.get<string>('R2_ACCESS_KEY_ID');
      const awsSecretAccessKey = this.configService.get<string>('R2_SECRET_ACCESS_KEY');

      const storageOptions: Record<string, string> = {
        awsEndpoint: awsEndpoint || '',
        awsAccessKeyId: awsAccessKeyId || '',
        awsSecretAccessKey: awsSecretAccessKey || '',
        awsRegion: 'auto',
        allowHttp: 'false',
        virtualHostedStyleRequest: 'false',
      };

      this.db = await lancedb.connect(targetUri, { storageOptions });
    } else {
      const resolvedPath = path.isAbsolute(targetUri)
        ? targetUri
        : path.resolve(process.cwd(), targetUri);
      this.db = await lancedb.connect(resolvedPath);
    }

    this.table = await this.db.openTable(tableName);
    const count = await this.table.countRows();
    this.logger.log(`Successfully connected to LanceDB table: ${tableName} (${count} vectors)`);
  }

  /**
   * Search for top-K similar chunks using Cosine metric and projection of required columns.
   */
  async search(
    queryVector: number[],
    topK: number = 5,
    category?: string,
  ): Promise<ScientificChunk[]> {
    if (!queryVector || queryVector.length !== 768) {
      throw new BadRequestException('Query vector must be an array of exactly 768 dimensions');
    }

    if (!this.table) {
      this.logger.log('LanceDB table not initialized yet. Attempting connection now...');
      await this.initLanceDb();
    }

    if (!this.table) {
      throw new Error('LanceDB table is not available.');
    }

    const candidateLimit = Math.max(topK * 3, 20);
    let builder = (this.table.search(queryVector) as any)
      .distanceType('cosine')
      .limit(candidateLimit);

    if (category && category.trim() !== '') {
      const sanitized = category.trim().replace(/'/g, "\\'");
      builder = builder.where(`primary_category = '${sanitized}'`);
    }

    builder = builder.select([
      'chunk_id',
      'paper_id',
      'title',
      'authors',
      'primary_category',
      'section_title',
      'section_type',
      'text',
      'context_text',
      'word_count',
      '_distance',
    ]);

    const results = await builder.toArray();
    return results as unknown as ScientificChunk[];
  }

  isReady(): boolean {
    return this.table !== null;
  }
}
