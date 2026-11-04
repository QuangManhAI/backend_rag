import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** Source families present in the Silver Parquet corpus. */
export const PAPER_SOURCES = [
  'arxiv',
  'openalex',
  'cvf',
  'zenodo',
  'openreview',
] as const;

export type PaperSource = (typeof PAPER_SOURCES)[number];

/**
 * A scientific paper. `_id` is the natural external key (`paper_id`), e.g.
 * `2106.09685`, `s2_<sha1>`, `cvf_<Author>_<Venue>_<Year>`.
 */
@Schema({
  collection: 'papers',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class Paper {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ type: String, required: true, enum: PAPER_SOURCES })
  source: PaperSource;

  @Prop({ required: true })
  title: string;

  @Prop({ type: [String], default: [] })
  authors: string[];

  @Prop({ type: [String], default: [] })
  author_ids: string[];

  @Prop({ default: '' })
  primary_category: string;

  @Prop({ type: [String], default: [] })
  categories: string[];

  @Prop({ type: Number, min: 1900 })
  year: number;

  @Prop({ type: String, default: null })
  doi: string | null;

  @Prop({ type: String, default: null })
  journal_ref: string | null;

  @Prop({ default: '' })
  abstract: string;

  /** Dedup key over the abstract text — NOT the integrity checksum. */
  @Prop({ type: String, default: null })
  abstract_hash: string | null;

  @Prop({ type: String, default: null })
  published_date: string | null;

  @Prop({ type: String, default: null })
  crawled_at: string | null;

  @Prop({ type: String, default: null })
  transformed_at: string | null;

  @Prop({ type: String, default: null })
  pdf_url: string | null;

  @Prop({ type: String, default: null })
  html_url: string | null;

  @Prop({ type: Number, min: 0, default: 0 })
  cite_count: number;

  @Prop({ type: Number, min: 0, default: 0 })
  total_sections: number;

  @Prop({ type: Number, min: 0, default: 0 })
  total_math_count: number;

  @Prop({ type: Number, min: 0, default: 0 })
  total_words: number;

  @Prop({ type: String, default: null })
  sections_json: string | null;

  @Prop({ type: Number, min: 0, default: 0 })
  chunk_count: number;

  /** Integrity checksum over the paper's chunks (see `corpus/checksum.ts`). */
  @Prop({ type: String, default: null })
  content_sha256: string | null;

  @Prop({ required: true })
  dataset_version: string;

  @Prop({ required: true, default: 1 })
  schema_version: number;

  created_at: Date;
  updated_at: Date;
}

export type PaperDocument = HydratedDocument<Paper>;
export const PaperSchema = SchemaFactory.createForClass(Paper);

PaperSchema.index({ doi: 1 }, { unique: true, sparse: true });
PaperSchema.index({ primary_category: 1, year: -1 });
PaperSchema.index({ author_ids: 1 });
PaperSchema.index({ source: 1, year: -1 });
PaperSchema.index({ dataset_version: 1 });
