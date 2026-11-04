/**
 * Classifies an object or identifier into a source family.
 *
 * The families are the ones the schema declares in `papers.source` and
 * `source_objects.source`: arxiv, openalex, cvf, zenodo, openreview.
 */

export const SOURCE_FAMILIES = [
  'arxiv',
  'openalex',
  'cvf',
  'zenodo',
  'openreview',
] as const;

export type SourceFamily = (typeof SOURCE_FAMILIES)[number];

export function isSourceFamily(value: string): value is SourceFamily {
  return (SOURCE_FAMILIES as readonly string[]).includes(value);
}

/** Maps the pipeline's own `source` label onto a schema source family. */
export function fromPipelineLabel(label: string): SourceFamily | null {
  switch (label) {
    case 'arxiv':
    case 'arxiv_rss_realtime':
      return 'arxiv';
    case 'openalex':
      return 'openalex';
    case 'cvf':
      return 'cvf';
    case 'zenodo':
      return 'zenodo';
    case 'openreview':
      return 'openreview';
    // Semantic Scholar records are arXiv records with a different identifier
    // scheme; the schema has no separate family for them.
    case 'semantic_scholar':
      return 'arxiv';
    default:
      return null;
  }
}

/**
 * Infers the source family from a `paper_id`.
 *
 * Identifier shapes observed in the corpus:
 *   `2106.09685`        arXiv, new style
 *   `cs/0003055`        arXiv, old style
 *   `s2_<sha1>`         Semantic Scholar hash (an arXiv record)
 *   `cvf_<Author>_<…>`  CVF open-access proceedings
 */
export function fromPaperId(paperId: string): SourceFamily | null {
  if (paperId.startsWith('cvf_')) return 'cvf';
  if (paperId.startsWith('s2_')) return 'arxiv';
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(paperId)) return 'arxiv';
  if (/^[a-z-]+(\.[A-Z]{2})?\/\d{7}(v\d+)?$/.test(paperId)) return 'arxiv';
  return null;
}

/**
 * Infers the source family from a Bronze object key.
 *
 * The Bronze layout is `bronze/<family>/...`, which is the authoritative
 * signal — the filename alone is ambiguous between families.
 *
 * The observed layout is:
 *   `bronze/arxiv/`             arXiv HTML, gzipped, by year
 *   `bronze/papers/`            arXiv API metadata, JSON, by year
 *   `bronze/openalex/`          OpenAlex metadata
 *   `bronze/semantic_scholar/`  Semantic Scholar PDFs, by year
 *
 * Note that `bronze/papers/` holds *arXiv* metadata despite its generic name.
 */
export function fromBronzeKey(key: string): SourceFamily | null {
  const m = /^bronze\/([^/]+)\//.exec(key);
  if (!m) return null;
  switch (m[1]) {
    case 'arxiv':
    case 'papers':
    case 'semantic_scholar':
      return 'arxiv';
    case 'openalex':
      return 'openalex';
    default:
      return null;
  }
}
