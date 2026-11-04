import { S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';

/**
 * A configured S3 client for the MinIO object store.
 *
 * Two details matter and both are easy to get wrong:
 *
 *  - `forcePathStyle` — MinIO serves objects under `/{bucket}/{key}`, not under
 *    the virtual-host style `bucket.host`. Without this the SDK tries to
 *    resolve `uth-scientific-lakehouse.s3.minio-quangmanh.io.vn`, which does
 *    not exist in DNS.
 *  - `region` — the SDK refuses to sign a request without one, even though
 *    MinIO ignores its value. `auto` is the convention for S3-compatible
 *    stores.
 *
 * The client is created lazily: the MinIO settings are optional in the
 * environment, and the application does not need the object store at all.
 */
@Injectable()
export class MinioService {
  private readonly logger = new Logger(MinioService.name);
  private cached: S3Client | null = null;
  private cachedBucket: string | null = null;

  constructor(private readonly config: AppConfigService) {}

  /** The bucket name, or null when MinIO is not configured. */
  get bucket(): string | null {
    return this.config.get('MINIO_BUCKET_NAME') ?? null;
  }

  /** True when the object store is configured. */
  isConfigured(): boolean {
    return Boolean(
      this.config.get('MINIO_ENDPOINT') &&
      this.config.get('MINIO_ACCESS_KEY') &&
      this.config.get('MINIO_SECRET_KEY') &&
      this.config.get('MINIO_BUCKET_NAME'),
    );
  }

  /** The client, created on first use. */
  get client(): S3Client {
    if (this.cached) return this.cached;
    const endpoint = this.config.get('MINIO_ENDPOINT');
    const accessKeyId = this.config.get('MINIO_ACCESS_KEY');
    const secretAccessKey = this.config.get('MINIO_SECRET_KEY');
    const bucket = this.config.get('MINIO_BUCKET_NAME');
    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
      throw new Error(
        'MinIO is not configured: MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY and MINIO_BUCKET_NAME are required.',
      );
    }
    this.cachedBucket = bucket;
    this.cached = new S3Client({
      endpoint,
      region: this.config.get('MINIO_REGION'),
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
    this.logger.log({ endpoint, bucket }, 'MINIO_CLIENT_READY');
    return this.cached;
  }
}
