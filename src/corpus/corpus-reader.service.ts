import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Injectable, Logger } from '@nestjs/common';
import { Connection, Model } from 'mongoose';
import { CORPUS_CONNECTION } from './corpus.module';
import { Author, AuthorDocument } from './schemas/author.schema';
import { Category, CategoryDocument } from './schemas/category.schema';
import {
  AssociationRule,
  AssociationRuleDocument,
} from './schemas/association-rule.schema';
import { Paper, PaperDocument } from './schemas/paper.schema';
import { PaperChunk, PaperChunkDocument } from './schemas/paper-chunk.schema';
import { WorldNode, WorldNodeDocument } from './schemas/world-node.schema';
import { itemToWords } from '../mining/name-normalizer';

export interface CorpusChunk {
  chunk_id: string;
  paper_id: string;
  chunk_index: number | null;
  section_title: string | null;
  section_type: string | null;
  text: string;
  text_sha256: string;
  word_count: number;
}

export interface CorpusPaper {
  _id: string;
  source: string;
  title: string;
  authors: string[];
  primary_category: string;
  year: number | null;
  abstract: string;
  chunk_count: number;
}

/**
 * Read side of the corpus.
 *
 * Every method here is either an indexed point read or a single scan at
 * startup. Nothing in this service is called on the hot RAG path — that path
 * still talks to Qdrant — so a corpus read never adds a round trip to
 * `POST /api/v1/rag/chat`.
 */
@Injectable()
export class CorpusReaderService {
  private readonly logger = new Logger(CorpusReaderService.name);

  constructor(
    @InjectConnection(CORPUS_CONNECTION)
    private readonly connection: Connection,
    @InjectModel(Paper.name, CORPUS_CONNECTION)
    private readonly papers: Model<PaperDocument>,
    @InjectModel(PaperChunk.name, CORPUS_CONNECTION)
    private readonly chunks: Model<PaperChunkDocument>,
    @InjectModel(Author.name, CORPUS_CONNECTION)
    private readonly authors: Model<AuthorDocument>,
    @InjectModel(Category.name, CORPUS_CONNECTION)
    private readonly categories: Model<CategoryDocument>,
    @InjectModel(AssociationRule.name, CORPUS_CONNECTION)
    private readonly associationRules: Model<AssociationRuleDocument>,
    @InjectModel(WorldNode.name, CORPUS_CONNECTION)
    private readonly worldNodes: Model<WorldNodeDocument>,
  ) {}

  /**
   * True when the corpus connection is up and the corpus is *usable*.
   *
   * Counting documents is not enough: a corpus whose chunks carry no `text`
   * is a shell, and serving it would be worse than serving nothing. The probe
   * therefore requires a document whose text is actually present.
   */
  async isReady(): Promise<boolean> {
    try {
      // `readyState` is a numeric enum in Mongoose and a plain number here.
      if (Number(this.connection.readyState) !== 1) return false;
      const withText = await this.chunks
        .exists({ text: { $exists: true, $ne: '' } })
        .exec();
      return withText !== null;
    } catch (e) {
      this.logger.warn({ err: String(e) }, 'CORPUS_PROBE_FAILED');
      return false;
    }
  }

  /**
   * One paper plus its chunks, in two indexed reads — never a `$lookup`.
   *
   * Only chunks that carry text are returned: the endpoint serves the chunk
   * bodies, and a chunk without one would reach the client as an empty
   * passage. The corpus is filled progressively, so a paper can be half
   * ingested — the caller falls back to Qdrant for the missing half.
   */
  async readPaper(
    paperId: string,
  ): Promise<{ paper: CorpusPaper; chunks: CorpusChunk[] } | null> {
    const paper = await this.papers.findById(paperId).lean().exec();
    if (!paper) return null;
    const chunks = await this.chunks
      .find({ paper_id: paperId, text: { $exists: true, $ne: '' } })
      .sort({ chunk_index: 1 })
      .lean()
      .exec();
    if (chunks.length === 0) return null;
    return {
      paper: paper as unknown as CorpusPaper,
      chunks: chunks as unknown as CorpusChunk[],
    };
  }

  /** The authority table — only the authors that carry a PageRank. */
  async readAuthority(): Promise<{
    pagerank: Map<string, number>;
    max: number;
  }> {
    const rows = await this.authors
      .find({ pagerank: { $gt: 0 } })
      .sort({ pagerank: -1 })
      .lean()
      .exec();
    const pagerank = new Map<string, number>();
    for (const row of rows) pagerank.set(row._id, row.pagerank);
    const max = rows.length > 0 ? rows[0].pagerank : 0;
    return { pagerank, max };
  }

  /** The mining rules, strongest first (confidence × lift). */
  async readRules(): Promise<
    Array<{
      antecedents: string[][];
      consequents: string[][];
      score: number;
    }>
  > {
    const rows = await this.associationRules.find({}).lean().exec();
    const out: Array<{
      antecedents: string[][];
      consequents: string[][];
      score: number;
    }> = [];
    for (const row of rows) {
      const antecedents = row.antecedents
        .map((item) => itemToWords(item))
        .filter((w): w is string[] => w !== null);
      const consequents = row.consequents
        .map((item) => itemToWords(item))
        .filter((w): w is string[] => w !== null);
      if (!antecedents.length || !consequents.length) continue;
      out.push({ antecedents, consequents, score: row.score });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  /** Every category, as the index ➔ code mapping the frontend expects. */ async readCategories(): Promise<
    Array<{ index: number; code: string; name: string }>
  > {
    const rows = await this.categories.find({}).lean().exec();
    return rows.map((c) => ({
      index: Number.parseInt(c._id, 10),
      code: c.code,
      name: c.name,
    }));
  }

  /** The world tree nodes, grouped by depth. */
  async readWorldNodes(): Promise<{
    version: string | null;
    nodes: Array<{
      id: number;
      parent_id: number | null;
      depth: 0 | 1 | 2;
      label: string;
      vector: Float32Array | null;
    }>;
  }> {
    const rows = await this.worldNodes.find({}).lean().exec();
    const nodes = rows.map((row) => {
      // The binary field arrives as a BSON `Binary` in a lean query. It is
      // copied into a fresh, correctly aligned array: MongoDB does not
      // guarantee 4-byte alignment, which a Float32Array view would require.
      let vector: Float32Array | null = null;
      const raw = row.vector as unknown;
      const bytes =
        raw instanceof Buffer
          ? raw
          : raw && typeof (raw as { buffer?: unknown }).buffer === 'object'
            ? Buffer.from((raw as { buffer: Uint8Array }).buffer)
            : null;
      if (bytes && bytes.length >= 4) {
        vector = new Float32Array(bytes.length / 4);
        for (let i = 0; i < vector.length; i += 1) {
          vector[i] = bytes.readFloatLE(i * 4);
        }
      }
      return {
        id: Number.parseInt(row._id, 10),
        parent_id:
          row.parent_id === null ? null : Number.parseInt(row.parent_id, 10),
        depth: row.depth as 0 | 1 | 2,
        label: row.label,
        vector,
      };
    });
    return { version: null, nodes };
  }
}
