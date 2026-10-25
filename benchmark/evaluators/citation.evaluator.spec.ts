import { evaluateCitations } from './citation.evaluator';

describe('Citation Evaluator Unit Tests', () => {
  const mockContext = [
    {
      paper_id: '2106.09685',
      text: 'LoRA freezes weights and injects trainable rank decomposition matrices.',
    },
    {
      paper_id: '1706.03762',
      text: 'The Transformer model is based entirely on attention mechanisms without recurrence.',
    },
  ];

  it('correctly identifies valid in-context citations', () => {
    const answer =
      'LoRA reduces trainable parameters [Paper: 2106.09685]. Attention is used in Transformers [Paper: 1706.03762].';

    const res = evaluateCitations(answer, mockContext);
    expect(res.total_citations_found).toBe(2);
    expect(res.extracted_citation_ids).toEqual(['2106.09685', '1706.03762']);
    expect(res.format_valid).toBe(true);
    expect(res.in_context_citations).toEqual(['2106.09685', '1706.03762']);
    expect(res.hallucinated_citations).toHaveLength(0);
    expect(res.id_precision).toBe(1.0);
  });

  it('detects hallucinated paper IDs not in context', () => {
    const answer =
      'LoRA is efficient [Paper: 2106.09685]. Also see [Paper: 9999.99999] for details.';

    const res = evaluateCitations(answer, mockContext);
    expect(res.total_citations_found).toBe(2);
    expect(res.in_context_citations).toEqual(['2106.09685']);
    expect(res.hallucinated_citations).toEqual(['9999.99999']);
    expect(res.id_precision).toBe(0.5); // 1 valid out of 2 cited
  });

  it('detects malformed citation brackets', () => {
    const answer = 'LoRA is described in [Paper 2106.09685 without colon.';
    const res = evaluateCitations(answer, mockContext);
    expect(res.format_valid).toBe(false);
    expect(res.malformed_citations.length).toBeGreaterThan(0);
  });

  it('calculates reference citation precision and recall when provided', () => {
    const answer = 'LoRA is described in [Paper: 2106.09685].';
    const referenceCitations = ['2106.09685', '1706.03762'];

    const res = evaluateCitations(answer, mockContext, referenceCitations);
    expect(res.reference_citation_precision).toBe(1.0); // 1 cited, which is in reference => 1/1 = 1.0
    expect(res.reference_citation_recall).toBe(0.5); // 1 hit out of 2 expected references => 1/2 = 0.5
  });
});
