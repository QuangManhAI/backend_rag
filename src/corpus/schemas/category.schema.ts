import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * A category in the world tree. `_id` is the numeric index used by the
 * frontend's 3D world; `code` is the arXiv-style code such as `cs.LG`.
 */
@Schema({
  collection: 'categories',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class Category {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ required: true })
  code: string;

  @Prop({ default: '' })
  name: string;

  @Prop({ default: '#888888' })
  color: string;

  @Prop({ required: true, default: 1 })
  schema_version: number;

  created_at: Date;
  updated_at: Date;
}

export type CategoryDocument = HydratedDocument<Category>;
export const CategorySchema = SchemaFactory.createForClass(Category);
