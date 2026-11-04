import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

/**
 * A node of the 3D world tree, with its centroid inlined when it has one.
 *
 * The former `world_nodes` + `world_centroids` pair had a 1–1 relationship and
 * were always read together, so they are merged here: one query returns both.
 */
@Schema({
  collection: 'world_nodes',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class WorldNode {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ type: String, default: null })
  parent_id: string | null;

  @Prop({ type: Number, required: true, enum: [0, 1, 2] })
  depth: number;

  @Prop({ required: true })
  label: string;

  /** Centroid as 768 little-endian float32 values. Null when absent. */
  @Prop({
    type: MongooseSchema.Types.Buffer,
    default: null,
  })
  vector: Buffer | null;

  /** SHA-256 over the raw float32 bytes of `vector`. */
  @Prop({ type: String, default: null })
  vector_sha256: string | null;

  @Prop({ required: true, default: 1 })
  schema_version: number;

  created_at: Date;
  updated_at: Date;
}

export type WorldNodeDocument = HydratedDocument<WorldNode>;
export const WorldNodeSchema = SchemaFactory.createForClass(WorldNode);

WorldNodeSchema.index({ depth: 1 });
WorldNodeSchema.index({ parent_id: 1 });
