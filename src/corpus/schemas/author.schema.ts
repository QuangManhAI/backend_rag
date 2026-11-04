import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * A co-authorship-graph author.
 *
 * `_id` is the normalised name, matching
 * [`backend_rag/src/mining/name-normalizer.ts`](../../mining/name-normalizer.ts),
 * so the runtime authority lookup becomes an exact key match instead of a
 * substring scan over 157 725 influencers.
 */
@Schema({
  collection: 'authors',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class Author {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ default: '' })
  display_name: string;

  /** 0 means "present in the graph but unranked". */
  @Prop({ type: Number, min: 0, default: 0 })
  pagerank: number;

  @Prop({ type: Number, min: 0, default: null })
  degree: number | null;

  @Prop({ type: Number, min: 0, default: 0 })
  paper_count: number;

  @Prop({ required: true, default: 1 })
  schema_version: number;

  created_at: Date;
  updated_at: Date;
}

export type AuthorDocument = HydratedDocument<Author>;
export const AuthorSchema = SchemaFactory.createForClass(Author);

AuthorSchema.index({ pagerank: -1 });
