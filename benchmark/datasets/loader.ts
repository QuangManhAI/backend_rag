import * as fs from 'fs';
import * as path from 'path';
import {
  DatasetItem,
  datasetItemSchema,
  DatasetMetadata,
  datasetMetadataSchema,
} from './schema';

export interface DatasetValidationError {
  line: number;
  raw: string;
  error: string;
  code: string;
}

export interface DatasetStats {
  totalLines: number;
  validCount: number;
  invalidCount: number;
  answerableCount: number;
  unanswerableCount: number;
  categories: Record<string, number>;
}

export interface DatasetLoadResult {
  metadata: DatasetMetadata;
  validItems: DatasetItem[];
  invalidItems: DatasetValidationError[];
  stats: DatasetStats;
  filePath?: string;
}

/**
 * Loads and validates a benchmark dataset from a JSONL file.
 * Lines starting with `#` are ignored as comments.
 * An optional first line containing `__metadata__` can configure dataset version/type.
 */
export function loadDatasetFromJsonl(filePath: string): DatasetLoadResult {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Dataset file not found: ${resolvedPath}`);
  }
  const content = fs.readFileSync(resolvedPath, 'utf8');
  return parseDatasetContent(content, resolvedPath);
}

/**
 * Parses raw JSONL string content and validates all samples.
 */
export function parseDatasetContent(
  content: string,
  filePath?: string,
): DatasetLoadResult {
  const lines = content.split(/\r?\n/);
  let metadata: DatasetMetadata = {
    version: '1.0.0',
    name: filePath ? path.basename(filePath) : 'In-memory dataset',
    corpus_type: 'real',
    created_at: new Date().toISOString(),
  };

  const validItems: DatasetItem[] = [];
  const invalidItems: DatasetValidationError[] = [];
  const seenQueryIds = new Set<string>();
  const categories: Record<string, number> = {};

  let answerableCount = 0;
  let unanswerableCount = 0;
  let processedLines = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine || rawLine.startsWith('#')) {
      continue;
    }
    processedLines++;

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawLine);
    } catch (e) {
      invalidItems.push({
        line: i + 1,
        raw: rawLine,
        error: `Invalid JSON syntax: ${(e as Error).message}`,
        code: 'INVALID_JSON',
      });
      continue;
    }

    // Check for optional metadata line: { "__metadata__": { "version": "1.0", ... } }
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      '__metadata__' in parsed
    ) {
      const metaParsed = datasetMetadataSchema.safeParse(
        (parsed as Record<string, unknown>).__metadata__,
      );
      if (metaParsed.success) {
        metadata = metaParsed.data;
      }
      continue;
    }

    const validation = datasetItemSchema.safeParse(parsed);
    if (!validation.success) {
      const issueMessages = validation.error.issues
        .map((iss) => `${iss.path.join('.')}: ${iss.message}`)
        .join('; ');
      invalidItems.push({
        line: i + 1,
        raw: rawLine,
        error: issueMessages,
        code: 'SCHEMA_VALIDATION_ERROR',
      });
      continue;
    }

    const item = validation.data;
    if (seenQueryIds.has(item.query_id)) {
      invalidItems.push({
        line: i + 1,
        raw: rawLine,
        error: `Duplicate query_id "${item.query_id}"`,
        code: 'DUPLICATE_QUERY_ID',
      });
      continue;
    }

    seenQueryIds.add(item.query_id);
    validItems.push(item);

    if (item.answerable) {
      answerableCount++;
    } else {
      unanswerableCount++;
    }

    const cat = item.category || 'uncategorized';
    categories[cat] = (categories[cat] || 0) + 1;
  }

  const stats: DatasetStats = {
    totalLines: processedLines,
    validCount: validItems.length,
    invalidCount: invalidItems.length,
    answerableCount,
    unanswerableCount,
    categories,
  };

  return {
    metadata,
    validItems,
    invalidItems,
    stats,
    filePath,
  };
}
