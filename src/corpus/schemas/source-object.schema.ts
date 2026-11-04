import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { PAPER_SOURCES, type PaperSource } from './paper.schema';

/** Content types of the Bronze objects. */
export const MEDIA_TYPES = [
  'text/html',
  'application/pdf',
  'application/json',
] as const;

export type MediaType = (typeof MEDIA_TYPES)[number];

/**
 * A reference to a raw Bronze object in MinIO.
 *
 * The bytes stay in MinIO — this collection stores the manifest only (bucket,
 * key, size, media type, source family). No content is ever downloaded or
 * copied into MongoDB.
 *
 * `_id` is `${bucket}/${key}`: the object's natural identity inside the
 * object store. Content addressing by hash was rejected because two papers
 * sharing identical bytes would collapse into one document and lose the link
 * back to their own raw file.
 */
@Schema({
  collection: 'source_objects',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class SourceObject {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ required: true })
  bucket: string;

  @Prop({ required: true })
  key: string;

  @Prop({ type: String, required: true, enum: PAPER_SOURCES })
  source: PaperSource;

  /** Identifier in the original source, e.g. `2403.01234`. */
  @Prop({ required: true })
  source_id: string;

  @Prop({ type: String, required: true, enum: MEDIA_TYPES })
  media_type: MediaType;

  @Prop({ required: true, min: 0 })
  size: number;

  /**
   * ETag reported by the object store.
   *
   * For a single-part upload MinIO/S3 reports the **MD5** of the raw bytes as
   * a 32-hex string — it is *not* a SHA-256. The field is named `etag` so it
   * says what it is; a real SHA-256 would need one `GetObject` per file
   * (3.8 GB of traffic) and was explicitly out of scope.
   */
  @Prop({ type: String, default: null })
  etag: string | null;

  /** One-way link to `papers._id`. */
  @Prop({ type: String, default: null })
  paper_id: string | null;

  @Prop({ required: true })
  dataset_version: string;

  @Prop({ required: true, default: 1 })
  schema_version: number;

  created_at: Date;
  updated_at: Date;
}

export type SourceObjectDocument = HydratedDocument<SourceObject>;
export const SourceObjectSchema = SchemaFactory.createForClass(SourceObject);

SourceObjectSchema.index({ paper_id: 1 });
SourceObjectSchema.index({ source: 1, source_id: 1 });
SourceObjectSchema.index({ etag: 1 });
SourceObjectSchema.index({ dataset_version: 1 });
