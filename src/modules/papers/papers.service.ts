import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { LRUCache } from 'lru-cache';
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
export const PAPER_BATCH_MAX = 20;

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

/** `GET /papers/:paper_id`: built from the paper's Qdrant chunks, nothing stored in MongoDB. */
@Injectable()
export class PapersService {
  private readonly cache = new LRUCache<string, PaperDetail>({
    max: 1000,
    ttl: 10 * 60 * 1000,
  });

  constructor(
    @Inject(VECTOR_STORE_PORT) private readonly vectors: VectorStorePort,
    private readonly router: TreeRouterService,
  ) {}

  async get(paperId: string): Promise<PaperDetail> {
    const id = paperId.trim();
    if (!id || id.length > PAPER_ID_MAX)
      throw new NotFoundException(PAPER_NOT_FOUND);
    const hit = this.cache.get(id);
    if (hit) return hit;
    const chunks = await this.vectors.scrollByPaper(id);
    if (!chunks.length) throw new NotFoundException(PAPER_NOT_FOUND);
    const detail = buildPaperDetail(id, chunks, (code) =>
      this.router.categoryIndex(code),
    );
    this.cache.set(id, detail);
    return detail;
  }

  /** Batch read: unknown papers are reported, not failed; a Qdrant outage fails the whole call. */
  async getMany(
    ids: string[],
  ): Promise<{ items: PaperDetail[]; not_found: string[] }> {
    const results = await Promise.all(
      ids.map((id) =>
        this.get(id).catch((e: unknown) => {
          if (e instanceof NotFoundException) return id;
          throw e;
        }),
      ),
    );
    return {
      items: results.filter((r) => typeof r !== 'string'),
      not_found: results.filter((r) => typeof r === 'string'),
    };
  }
}
