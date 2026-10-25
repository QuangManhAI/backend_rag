import { parseDatasetContent } from './loader';

describe('Dataset Loader and Validator Unit Tests', () => {
  it('parses valid JSONL with metadata and comments', () => {
    const raw = `
      # Header comment
      {"__metadata__": {"version": "2.0.0", "name": "Custom Eval", "corpus_type": "synthetic"}}
      {"query_id": "q1", "query": "What is LoRA?", "category": "cs.LG", "answerable": true, "relevant_paper_ids": ["2106.09685"]}
      # Middle comment
      {"query_id": "q2", "query": "What is sourdough?", "category": "food", "answerable": false}
    `;

    const res = parseDatasetContent(raw);
    expect(res.metadata.version).toBe('2.0.0');
    expect(res.metadata.name).toBe('Custom Eval');
    expect(res.metadata.corpus_type).toBe('synthetic');

    expect(res.validItems).toHaveLength(2);
    expect(res.invalidItems).toHaveLength(0);
    expect(res.stats.validCount).toBe(2);
    expect(res.stats.answerableCount).toBe(1);
    expect(res.stats.unanswerableCount).toBe(1);
    expect(res.stats.categories['cs.LG']).toBe(1);
    expect(res.stats.categories['food']).toBe(1);
  });

  it('detects syntax error on invalid JSON lines', () => {
    const raw = `
      {"query_id": "q1", "query": "Valid line", "answerable": true, "relevant_paper_ids": ["p1"]}
      {this is not valid json}
    `;

    const res = parseDatasetContent(raw);
    expect(res.validItems).toHaveLength(1);
    expect(res.invalidItems).toHaveLength(1);
    expect(res.invalidItems[0].code).toBe('INVALID_JSON');
    expect(res.invalidItems[0].line).toBe(3);
  });

  it('rejects answerable sample without any ground truth documents', () => {
    const raw = `
      {"query_id": "q_missing", "query": "Answerable question with no GT", "answerable": true}
    `;

    const res = parseDatasetContent(raw);
    expect(res.validItems).toHaveLength(0);
    expect(res.invalidItems).toHaveLength(1);
    expect(res.invalidItems[0].code).toBe('SCHEMA_VALIDATION_ERROR');
    expect(res.invalidItems[0].error).toContain('Answerable query must specify');
  });

  it('allows unanswerable sample without ground truth documents', () => {
    const raw = `
      {"query_id": "q_unans", "query": "Out of domain query", "answerable": false}
    `;

    const res = parseDatasetContent(raw);
    expect(res.validItems).toHaveLength(1);
    expect(res.validItems[0].answerable).toBe(false);
  });

  it('detects duplicate query_ids', () => {
    const raw = `
      {"query_id": "dup_1", "query": "First instance", "answerable": true, "relevant_paper_ids": ["p1"]}
      {"query_id": "dup_1", "query": "Second instance with same ID", "answerable": true, "relevant_paper_ids": ["p2"]}
    `;

    const res = parseDatasetContent(raw);
    expect(res.validItems).toHaveLength(1);
    expect(res.invalidItems).toHaveLength(1);
    expect(res.invalidItems[0].code).toBe('DUPLICATE_QUERY_ID');
  });

  it('deduplicates paper IDs and chunk IDs within the same sample', () => {
    const raw = `
      {"query_id": "q_dup_arr", "query": "Test deduplication", "answerable": true, "relevant_paper_ids": ["p1", "p2", "p1"]}
    `;

    const res = parseDatasetContent(raw);
    expect(res.validItems).toHaveLength(1);
    expect(res.validItems[0].relevant_paper_ids).toEqual(['p1', 'p2']);
  });
});
