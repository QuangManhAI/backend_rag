import {
  chunkTextSha256,
  datasetContentSha256,
  paperContentSha256,
  sha256,
  sha256Bytes,
} from './checksum';

describe('corpus checksum', () => {
  describe('sha256', () => {
    it('matches the known digest of the empty string', () => {
      expect(sha256('')).toBe(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      );
    });

    it('matches the known digest of "abc"', () => {
      expect(sha256('abc')).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    });

    it('hashes the UTF-8 bytes, not the UTF-16 code units', () => {
      // "é" is two bytes in UTF-8 (0xC3 0xA9) but one UTF-16 code unit.
      expect(sha256('é')).toBe(sha256Bytes(Buffer.from('é', 'utf8')));
      expect(sha256('é')).not.toBe(sha256('e'));
    });
  });

  describe('sha256Bytes', () => {
    it('agrees with the string variant on the same content', () => {
      expect(sha256Bytes(Buffer.from('hello', 'utf8'))).toBe(sha256('hello'));
    });
  });

  describe('chunkTextSha256', () => {
    it('is stable across calls', () => {
      const text = 'A stable tracking control rule is proposed.';
      expect(chunkTextSha256(text)).toBe(chunkTextSha256(text));
    });

    it('changes when the text changes', () => {
      expect(chunkTextSha256('abc')).not.toBe(chunkTextSha256('abd'));
    });

    it('distinguishes a trailing space', () => {
      expect(chunkTextSha256('abc')).not.toBe(chunkTextSha256('abc '));
    });
  });

  describe('paperContentSha256', () => {
    const chunks = [
      { chunk_id: 'p1_sec0', text: 'first' },
      { chunk_id: 'p1_sec1', text: 'second' },
      { chunk_id: 'p1_sec2', text: 'third' },
    ];

    it('is stable for the same input', () => {
      expect(paperContentSha256(chunks)).toBe(paperContentSha256(chunks));
    });

    it('changes when the reading order changes', () => {
      const reordered = [chunks[0], chunks[2], chunks[1]];
      expect(paperContentSha256(chunks)).not.toBe(
        paperContentSha256(reordered),
      );
    });

    it('changes when any chunk text changes', () => {
      const edited = [
        { chunk_id: 'p1_sec0', text: 'first' },
        { chunk_id: 'p1_sec1', text: 'second EDITED' },
        { chunk_id: 'p1_sec2', text: 'third' },
      ];
      expect(paperContentSha256(chunks)).not.toBe(paperContentSha256(edited));
    });

    it('changes when a chunk is removed', () => {
      expect(paperContentSha256(chunks)).not.toBe(
        paperContentSha256(chunks.slice(0, 2)),
      );
    });

    it('is not fooled by a chunk_id/text boundary shift', () => {
      // "a" + ":b" and "a:b" + "" must not collide once the id is joined in.
      const a = [{ chunk_id: 'x', text: 'a:b' }];
      const b = [{ chunk_id: 'x:a', text: 'b' }];
      expect(paperContentSha256(a)).not.toBe(paperContentSha256(b));
    });

    it('handles an empty chunk list', () => {
      expect(paperContentSha256([])).toBe(sha256(''));
    });
  });

  describe('datasetContentSha256', () => {
    const papers = [
      { paper_id: 'p2', content_sha256: 'bbb' },
      { paper_id: 'p1', content_sha256: 'aaa' },
    ];

    it('is stable across calls', () => {
      expect(datasetContentSha256(papers)).toBe(datasetContentSha256(papers));
    });

    it('does not depend on the input order', () => {
      const shuffled = [papers[1], papers[0]];
      expect(datasetContentSha256(papers)).toBe(datasetContentSha256(shuffled));
    });

    it('changes when a paper digest changes', () => {
      const edited = [
        { paper_id: 'p1', content_sha256: 'aaa' },
        { paper_id: 'p2', content_sha256: 'ccc' },
      ];
      expect(datasetContentSha256(papers)).not.toBe(
        datasetContentSha256(edited),
      );
    });

    it('changes when the counts change', () => {
      expect(datasetContentSha256(papers, { papers: 2 })).not.toBe(
        datasetContentSha256(papers, { papers: 3 }),
      );
    });

    it('does not depend on the key order of the counts object', () => {
      expect(datasetContentSha256(papers, { a: 1, b: 2 })).toBe(
        datasetContentSha256(papers, { b: 2, a: 1 }),
      );
    });
  });
});
