/** `[Paper: id]`, `[Paper: a, b]`; also `[Paper ID: id | Title …]` (the model copying a header). */
const CITATION_RE = /\[Paper(?:\s+ID)?:\s*([^\]|]+)[^\]]*\]/g;

/**
 * Paper ids cited as `[Paper: id]`, `[Paper: id1, id2]` or `[Paper ID: id | …]`, in order of first appearance, no
 * duplicates. Ids outside the retrieved context are kept (the frontend marks them unverified).
 */
export function extractCitations(answer: string): string[] {
  const out: string[] = [];
  for (const m of answer.matchAll(CITATION_RE)) {
    for (const part of m[1].split(',')) {
      const id = part.replace(/^\s*Paper:\s*/i, '').trim();
      if (id && !out.includes(id)) out.push(id);
    }
  }
  return out;
}
