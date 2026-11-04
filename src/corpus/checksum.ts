import { createHash } from 'crypto';

/**
 * Canonical SHA-256 helpers for the corpus integrity model.
 *
 * Three levels, per the design in `backend_rag/docs/MONGODB_SCHEMA_DESIGN.md` §11:
 *  - chunk:  `sha256(text)` over UTF-8 bytes.
 *  - paper:  `sha256(join("\n", ["<chunk_id>:<text_sha256>", ...]))` in chunk_index order.
 *  - dataset:`sha256(join("\n", sorted("<paper_id>:<content_sha256>")) + "|" + counts)`.
 *
 * Every rule is explicit about separators and ordering so the same inputs always
 * produce the same digest regardless of who computes it or in which order the
 * source rows were read.
 */

export interface ChunkDigestInput {
  chunk_id: string;
  text: string;
}

export interface PaperDigestInput {
  paper_id: string;
  content_sha256: string;
}

/** SHA-256 of a UTF-8 string, lowercase hex. */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** SHA-256 over raw bytes, lowercase hex. */
export function sha256Bytes(input: Buffer | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Chunk-level integrity digest. */
export function chunkTextSha256(text: string): string {
  return sha256(text);
}

/**
 * Paper-level integrity digest.
 *
 * `chunks` MUST already be in reading order (ascending `chunk_index`). The order
 * is part of the digest by design: reordering chunks changes the paper digest.
 */
export function paperContentSha256(chunks: ChunkDigestInput[]): string {
  const lines = chunks.map((c) => `${c.chunk_id}:${chunkTextSha256(c.text)}`);
  return sha256(lines.join('\n'));
}

/**
 * Dataset-level integrity digest.
 *
 * `counts` is serialised with sorted keys so that object key order cannot
 * change the digest.
 */
export function datasetContentSha256(
  papers: PaperDigestInput[],
  counts: Record<string, number> = {},
): string {
  const lines = [...papers]
    .map((p) => `${p.paper_id}:${p.content_sha256}`)
    .sort();
  const countLines = Object.keys(counts)
    .sort()
    .map((k) => `${k}=${counts[k]}`);
  return sha256([lines.join('\n'), countLines.join(',')].join('|'));
}
