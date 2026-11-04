import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

/** Which upstream store produced a dataset snapshot. */
export const DATASET_SOURCES = ['qdrant', 'silver', 'world', 'mining'] as const;

export type DatasetSource = (typeof DATASET_SOURCES)[number];

/**
 * A dataset snapshot marker.
 *
 * `_id` is the `dataset_version` stamped onto every ingested document. The
 * reconciliation job records the outcome of the last Qdrant comparison here.
 */
@Schema({
  collection: 'datasets',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class Dataset {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ type: String, required: true, enum: DATASET_SOURCES })
  source: DatasetSource;

  @Prop({ type: String, default: null })
  pipeline_version: string | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  counts: Record<string, number>;

  @Prop({ type: String, default: null })
  content_sha256: string | null;

  @Prop({ type: Date, default: null })
  ingested_at: Date | null;

  /** Last successful reconciliation against Qdrant. */
  @Prop({ type: Date, default: null })
  qdrant_verified_at: Date | null;

  /** Number of chunks that disagreed at the last reconciliation. */
  @Prop({ type: Number, min: 0, default: 0 })
  qdrant_drift_count: number;

  @Prop({ required: true, default: 1 })
  schema_version: number;
}

export type DatasetDocument = HydratedDocument<Dataset>;
export const DatasetSchema = SchemaFactory.createForClass(Dataset);
