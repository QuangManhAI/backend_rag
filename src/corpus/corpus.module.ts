import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MinioService } from './minio.service';
import { CorpusReaderService } from './corpus-reader.service';
import {
  AssociationRule,
  AssociationRuleSchema,
} from './schemas/association-rule.schema';
import { Author, AuthorSchema } from './schemas/author.schema';
import { Category, CategorySchema } from './schemas/category.schema';
import { Dataset, DatasetSchema } from './schemas/dataset.schema';
import { Paper, PaperSchema } from './schemas/paper.schema';
import { PaperChunk, PaperChunkSchema } from './schemas/paper-chunk.schema';
import {
  SourceObject,
  SourceObjectSchema,
} from './schemas/source-object.schema';
import { WorldNode, WorldNodeSchema } from './schemas/world-node.schema';

/** Name of the dedicated corpus connection (see `app.module.ts`). */
export const CORPUS_CONNECTION = 'corpus';

/**
 * The corpus half of the application.
 *
 * These models live on the `corpus` connection, not the default one: the
 * application database holds users and chat sessions, while the corpus holds
 * the scientific material. Separating them keeps the two very different write
 * and access profiles from competing for the same collection statistics.
 */
@Module({
  imports: [
    MongooseModule.forFeature(
      [
        { name: Paper.name, schema: PaperSchema },
        { name: PaperChunk.name, schema: PaperChunkSchema },
        { name: SourceObject.name, schema: SourceObjectSchema },
        { name: Author.name, schema: AuthorSchema },
        { name: Category.name, schema: CategorySchema },
        { name: WorldNode.name, schema: WorldNodeSchema },
        { name: AssociationRule.name, schema: AssociationRuleSchema },
        { name: Dataset.name, schema: DatasetSchema },
      ],
      CORPUS_CONNECTION,
    ),
  ],
  providers: [MinioService, CorpusReaderService],
  exports: [
    MongooseModule,
    MinioService,
    CorpusReaderService,
    Paper.name,
    PaperChunk.name,
    SourceObject.name,
    Author.name,
    Category.name,
    WorldNode.name,
    AssociationRule.name,
    Dataset.name,
  ],
})
export class CorpusModule {}
