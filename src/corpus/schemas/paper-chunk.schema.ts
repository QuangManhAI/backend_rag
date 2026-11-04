import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * A chunk of paper text. `_id` is the `chunk_id` (e.g. `2106.09685_sec8_p2`).
 *
 * `text` is the exact input the embedder consumes, so re-deriving the Qdrant
 * vectors from this collection reproduces the existing index exactly.
 */
@Schema({
  collection: 'paper_chunks',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class PaperChunk {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ type: String, required: true })
  paper_id: string;

  /** Reading-order position, derived from `chunk_id`. Null when unparseable. */
  @Prop({ type: Number, min: 0, default: null })
  chunk_index: number | null;

  /** Twig node in the world tree. Null until the world tree is joined. */
  @Prop({ type: Number, default: null })
  twig_id: number | null;

  @Prop({ type: String, default: null })
  section_title: string | null;

  /** Raw pipeline label — not the frontend's 6-way section taxonomy. */
  @Prop({ type: String, default: null })
  section_type: string | null;

  @Prop({ required: true })
  text: string;

  /** SHA-256 over the UTF-8 bytes of `text`. */
  @Prop({ required: true })
  text_sha256: string;

  @Prop({ type: Number, min: 0, default: 0 })
  word_count: number;

  @Prop({ required: true })
  dataset_version: string;

  @Prop({ required: true, default: 1 })
  schema_version: number;

  created_at: Date;
  updated_at: Date;
}

export type PaperChunkDocument = HydratedDocument<PaperChunk>;
export const PaperChunkSchema = SchemaFactory.createForClass(PaperChunk);

PaperChunkSchema.index({ paper_id: 1, chunk_index: 1 });
PaperChunkSchema.index({ dataset_version: 1 });
