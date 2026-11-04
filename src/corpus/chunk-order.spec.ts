import {
  assignChunkIndexes,
  chunkOrderKey,
  compareChunkOrder,
  isAbstractChunk,
  parseChunkPosition,
} from './chunk-order';

describe('corpus chunk order', () => {
  describe('parseChunkPosition', () => {
    it('parses the bare abstract form', () => {
      expect(parseChunkPosition('2106.09685_abs')).toEqual({
        section: 0,
        part: 0,
        is_abstract: true,
      });
    });

    it('parses a split abstract', () => {
      expect(parseChunkPosition('2106.09685_abs_p2')).toEqual({
        section: 0,
        part: 2,
        is_abstract: true,
      });
    });

    it('parses a bare section', () => {
      expect(parseChunkPosition('2106.09685_sec3')).toEqual({
        section: 3,
        part: 0,
        is_abstract: false,
      });
    });

    it('parses a split section', () => {
      expect(parseChunkPosition('2106.09685_sec3_p2')).toEqual({
        section: 3,
        part: 2,
        is_abstract: false,
      });
    });

    it('parses the old arXiv id form', () => {
      expect(parseChunkPosition('cs/0006023_abs_p1')).toEqual({
        section: 0,
        part: 1,
        is_abstract: true,
      });
    });

    it('parses the CVF id form', () => {
      expect(
        parseChunkPosition(
          'cvf_Jang_FADES_Fair_Disentanglement_with_Sensitive_Relevance_CVPR_2024_abs_p2',
        ),
      ).toEqual({ section: 0, part: 2, is_abstract: true });
    });

    it('parses the Semantic Scholar id form', () => {
      expect(
        parseChunkPosition(
          's2_a85e512d8845bd007b0866b4a97e8341463f8190_sec8_p2',
        ),
      ).toEqual({ section: 8, part: 2, is_abstract: false });
    });

    it('returns null for an identifier outside the grammar', () => {
      expect(parseChunkPosition('some-unstructured-id')).toBeNull();
    });

    it('does not treat a mid-string suffix as a position', () => {
      expect(parseChunkPosition('paper_sec3_extra')).toBeNull();
    });
  });

  describe('isAbstractChunk', () => {
    it('recognises the abstract family', () => {
      expect(isAbstractChunk('p_abs')).toBe(true);
      expect(isAbstractChunk('p_abs_p3')).toBe(true);
    });

    it('rejects the section family', () => {
      expect(isAbstractChunk('p_sec0')).toBe(false);
      expect(isAbstractChunk('p_sec0_p1')).toBe(false);
    });
  });

  describe('compareChunkOrder', () => {
    it('puts the abstract before every section', () => {
      expect(compareChunkOrder('p_abs', 'p_sec0')).toBeLessThan(0);
    });

    it('orders sections numerically, not lexicographically', () => {
      // The Parquet row order puts _sec10 before _sec1_p1; the derived order
      // must not inherit that inversion.
      expect(compareChunkOrder('p_sec1_p1', 'p_sec10')).toBeLessThan(0);
      expect(compareChunkOrder('p_sec2', 'p_sec10')).toBeLessThan(0);
    });

    it('orders parts numerically within a section', () => {
      expect(compareChunkOrder('p_sec4_p2', 'p_sec4_p10')).toBeLessThan(0);
    });

    it('orders the abstract parts among themselves', () => {
      expect(compareChunkOrder('p_abs', 'p_abs_p1')).toBeLessThan(0);
      expect(compareChunkOrder('p_abs_p2', 'p_abs_p10')).toBeLessThan(0);
    });

    it('is total: the reversed comparison is the negation', () => {
      const a = 'p_sec1_p1';
      const b = 'p_sec10';
      expect(Math.sign(compareChunkOrder(a, b))).toBe(
        -Math.sign(compareChunkOrder(b, a)),
      );
    });

    it('sorts a realistic reading order', () => {
      const ids = [
        '2210.03461_sec11',
        '2210.03461_sec1_p1',
        '2210.03461_abs',
        '2210.03461_sec10',
        '2210.03461_sec0_p2',
        '2210.03461_sec0_p1',
        '2210.03461_sec2',
      ];
      const sorted = [...ids].sort(compareChunkOrder);
      expect(sorted).toEqual([
        '2210.03461_abs',
        '2210.03461_sec0_p1',
        '2210.03461_sec0_p2',
        '2210.03461_sec1_p1',
        '2210.03461_sec2',
        '2210.03461_sec10',
        '2210.03461_sec11',
      ]);
    });
  });

  describe('chunkOrderKey', () => {
    it('puts unparseable identifiers last', () => {
      expect(chunkOrderKey('p_abs').group).toBeLessThan(
        chunkOrderKey('unstructured').group,
      );
    });
  });

  describe('assignChunkIndexes', () => {
    it('assigns dense zero-based indexes in reading order', () => {
      const chunks = [
        { chunk_id: 'p_sec10' },
        { chunk_id: 'p_abs' },
        { chunk_id: 'p_sec1_p1' },
        { chunk_id: 'p_sec1_p2' },
      ];
      const map = assignChunkIndexes(chunks);
      expect(map.get('p_abs')).toBe(0);
      expect(map.get('p_sec1_p1')).toBe(1);
      expect(map.get('p_sec1_p2')).toBe(2);
      expect(map.get('p_sec10')).toBe(3);
    });

    it('produces a gap-free sequence', () => {
      const chunks = Array.from({ length: 25 }, (_, i) => ({
        chunk_id: `p_sec${i}_p${(i % 3) + 1}`,
      }));
      const map = assignChunkIndexes(chunks);
      const indexes = [...map.values()].filter((v): v is number => v !== null);
      expect(indexes.sort((a, b) => a - b)).toEqual(
        Array.from({ length: 25 }, (_, i) => i),
      );
    });

    it('leaves an unparseable identifier null without shifting later indexes', () => {
      const chunks = [
        { chunk_id: 'p_abs' },
        { chunk_id: 'p_broken' },
        { chunk_id: 'p_sec1' },
      ];
      const map = assignChunkIndexes(chunks);
      expect(map.get('p_abs')).toBe(0);
      expect(map.get('p_broken')).toBeNull();
      expect(map.get('p_sec1')).toBe(1);
    });

    it('handles an empty input', () => {
      expect(assignChunkIndexes([]).size).toBe(0);
    });
  });
});
