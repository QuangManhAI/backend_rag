import {
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { LRUCache } from 'lru-cache';
import { CorpusReaderService } from '../corpus/corpus-reader.service';
import { TreeRouterService } from '../tree-router/tree-router.service';
import {
  ChunkPayload,
  PaperDetail,
  toSectionType,
} from '../types/scientific-rag';
import {
  VECTOR_STORE_PORT,
  type VectorStorePort,
} from '../vector-store/vector-store.service';

export const PAPER_NOT_FOUND = 'paper not found';
export const PAPER_ID_MAX = 200;

const isAbstract = (c: ChunkPayload) =>
  c.section_type.toLowerCase().startsWith('abstract');
const natural = new Intl.Collator('en', { numeric: true });

/**
 * Abstract chunks first, then reading order: `chunk_index` when every chunk has it, otherwise
 * the chunk_id in natural order (`_sec2` before `_sec10`).
 */
export function orderChunks(chunks: ChunkPayload[]): ChunkPayload[] {
  const byIndex = chunks.every((c) => typeof c.chunk_index === 'number');
  return [...chunks].sort((a, b) => {
    const abs = Number(isAbstract(b)) - Number(isAbstract(a));
    if (abs) return abs;
    if (byIndex) return (a.chunk_index as number) - (b.chunk_index as number);
    return natural.compare(a.chunk_id, b.chunk_id);
  });
}

export function buildPaperDetail(
  paperId: string,
  chunks: ChunkPayload[],
  categoryIndex: (code: string) => number,
): PaperDetail {
  const ordered = orderChunks(chunks);
  const head = ordered[0];
  const abstract =
    ordered.find((c) => c.section_type.toLowerCase() === 'abstract') ??
    ordered.find(isAbstract);
  return {
    paper_id: paperId,
    title: head.title,
    authors: head.authors,
    category_index: categoryIndex(head.primary_category),
    primary_category: head.primary_category,
    year: ordered.find((c) => c.year !== null)?.year ?? null,
    abstract: abstract?.text ?? '',
    has_fulltext: ordered.some((c) => !isAbstract(c)),
    chunks: ordered.map((c) => ({
      chunk_id: c.chunk_id,
      section_title: c.section_title,
      section_type: toSectionType(c.section_type),
      text: c.text,
    })),
  };
}

/**
 * `GET /papers/:paper_id`.
 *
 * The corpus in MongoDB is the source of truth: it holds the chunk text that
 * Qdrant's payload no longer carries. Qdrant remains the fallback, so the
 * endpoint keeps working before the corpus has been ingested.
 */
@Injectable()
export class PapersService {
  private readonly cache = new LRUCache<string, PaperDetail>({
    max: 1000,
    ttl: 10 * 60 * 1000,
  });

  constructor(
    @Inject(VECTOR_STORE_PORT) private readonly vectors: VectorStorePort,
    private readonly router: TreeRouterService,
    @Optional() private readonly corpus?: CorpusReaderService,
  ) {}

  async get(paperId: string): Promise<PaperDetail> {
    const id = paperId.trim();
    if (!id || id.length > PAPER_ID_MAX)
      throw new NotFoundException(PAPER_NOT_FOUND);
    const hit = this.cache.get(id);
    if (hit) return hit;

    const detail = (await this.fromCorpus(id)) ?? (await this.fromVectors(id));
    if (!detail) throw new NotFoundException(PAPER_NOT_FOUND);
    this.cache.set(id, detail);
    return detail;
  }

  /**
   * Reads the paper from the corpus — two indexed queries, no `$lookup`.
   *
   * The corpus is the source of truth, but it is filled progressively, so a
   * paper can be half ingested. A partial read is *not* served: the endpoint
   * would show the client an incomplete paper with no indication that
   * anything is missing. When the corpus copy is incomplete the caller falls
   * back to Qdrant instead.
   */
  private async fromCorpus(paperId: string): Promise<PaperDetail | null> {
    if (!this.corpus) return null;
    const read = await this.corpus.readPaper(paperId);
    if (!read || read.chunks.length === 0) return null;
    const { paper, chunks } = read;

    // `chunk_count` is the number of chunks the corpus knows about for this
    // paper. When it is known and the read returned fewer, the corpus copy is
    // still being written.
    if (
      typeof paper.chunk_count === 'number' &&
      paper.chunk_count > 0 &&
      chunks.length < paper.chunk_count
    ) {
      return null;
    }

    const payload: ChunkPayload[] = chunks.map((c) => ({
      chunk_id: c.chunk_id,
      paper_id: c.paper_id,
      title: paper.title,
      authors: paper.authors,
      primary_category: paper.primary_category,
      year: paper.year,
      section_title: c.section_title ?? '',
      section_type: c.section_type ?? '',
      text: c.text,
      chunk_index: c.chunk_index ?? undefined,
    }));
    return buildPaperDetail(paperId, payload, (code) =>
      this.router.categoryIndex(code),
    );
  }

  /** Falls back to the vector store while the corpus is still being filled. */
  private async fromVectors(paperId: string): Promise<PaperDetail | null> {
    const chunks = await this.vectors.scrollByPaper(paperId);
    if (!chunks.length) return null;
    return buildPaperDetail(paperId, chunks, (code) =>
      this.router.categoryIndex(code),
    );
  }
}
