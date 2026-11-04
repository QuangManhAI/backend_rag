import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * An FP-Growth association rule. Loaded once at startup into an in-memory
 * array; the runtime only needs the mined relations, not a query per request.
 */
@Schema({
  collection: 'association_rules',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
})
export class AssociationRule {
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ type: [String], required: true })
  antecedents: string[];

  @Prop({ type: [String], required: true })
  consequents: string[];

  @Prop({ type: Number, min: 0, default: 0 })
  support: number;

  @Prop({ type: Number, min: 0, default: 0 })
  confidence: number;

  @Prop({ type: Number, default: 0 })
  lift: number;

  @Prop({ type: Number, default: 0 })
  score: number;

  /** `tag:` or `cat:` — the namespace the items come from. */
  @Prop({ type: String, default: null })
  item_prefix: string | null;

  @Prop({ required: true, default: 1 })
  schema_version: number;

  created_at: Date;
  updated_at: Date;
}

export type AssociationRuleDocument = HydratedDocument<AssociationRule>;
export const AssociationRuleSchema =
  SchemaFactory.createForClass(AssociationRule);
