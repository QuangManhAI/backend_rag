import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Types } from 'mongoose';
import {
  decodeCursor,
  encodeCursor,
  keysetFilter,
  ListSpec,
  PaginationQueryDto,
  parseFilter,
  parseIds,
  parseSort,
  toCursorPage,
} from './pagination';

interface C {
  t: string;
  id: string;
}
const isC = (v: unknown): v is C =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as C).t === 'string' &&
  typeof (v as C).id === 'string';

describe('cursor', () => {
  it('round-trips', () => {
    const c = { t: '2026-10-20T00:00:00.000Z', id: 'abc' };
    expect(decodeCursor(encodeCursor(c), isC)).toEqual(c);
  });

  it.each([
    'abc!!',
    '',
    encodeCursor({ t: 1 }),
    Buffer.from('not json').toString('base64url'),
  ])('rejects %p', (bad) => {
    expect(() => decodeCursor(bad, isC)).toThrow(
      new BadRequestException('invalid cursor'),
    );
  });
});

describe('PaginationQueryDto', () => {
  const check = (q: object) =>
    validateSync(plainToInstance(PaginationQueryDto, q));

  it('defaults limit to 20', () => {
    expect(plainToInstance(PaginationQueryDto, {}).limit).toBe(20);
  });

  it('accepts 1..50', () => {
    expect(check({ limit: '1' })).toHaveLength(0);
    expect(check({ limit: '50' })).toHaveLength(0);
  });

  it('rejects out of range', () => {
    expect(check({ limit: '0' })).not.toHaveLength(0);
    expect(check({ limit: '51' })).not.toHaveLength(0);
  });
});

describe('query language', () => {
  const spec: ListSpec = {
    sortable: { created_at: 'date', title: 'string' },
    defaultSort: [{ field: 'created_at', dir: 'desc' }],
    idType: 'objectId',
  };

  it('parses multi-term sort and rejects anything off the whitelist', () => {
    expect(parseSort('title:asc,created_at:desc', spec)).toEqual([
      { field: 'title', dir: 'asc' },
      { field: 'created_at', dir: 'desc' },
    ]);
    expect(parseSort(undefined, spec)).toBe(spec.defaultSort);
    expect(parseSort('title', spec)).toEqual([{ field: 'title', dir: 'asc' }]);
    for (const bad of [
      'password_hash:asc',
      'title:up',
      'title:asc,title:desc',
      '__proto__:asc',
      'title:asc:x',
    ]) {
      expect(() => parseSort(bad, spec)).toThrow('invalid sort');
    }
  });

  it('parses comparisons, a bare value and match, keeping dates with colons intact', () => {
    expect(parseFilter('n', 'gt:20,lt:50', { type: 'number' })).toEqual({
      n: { $gt: 20, $lt: 50 },
    });
    expect(parseFilter('r', 'admin', { type: 'string' })).toEqual({
      r: { $eq: 'admin' },
    });
    expect(
      parseFilter('d', 'gte:2026-01-01T10:00:00Z', { type: 'date' }),
    ).toEqual({ d: { $gte: new Date('2026-01-01T10:00:00Z') } });
    expect(parseFilter('t', 'match:a.b,c', { type: 'string' })).toEqual({
      t: { $regex: 'a\\.b,c', $options: 'i' },
    });
  });

  it('never lets an operator or a wrong type through', () => {
    const cases: [string, Parameters<typeof parseFilter>[2]][] = [
      ['gt:abc', { type: 'number' }],
      ['match:x', { type: 'number' }],
      ['gt:5', { type: 'string' }],
      ['maybe', { type: 'boolean' }],
      ['nope', { type: 'objectId' }],
      ['root', { type: 'string', values: ['user', 'admin'] }],
      ['$where:1', { type: 'number' }],
    ];
    for (const [raw, field] of cases) {
      expect(() => parseFilter('f', raw, field)).toThrow('invalid filter: f');
    }
  });

  it('keyset cursors round-trip with ObjectId ids and are bound to their sort', () => {
    const terms = parseSort('title:asc', spec);
    const _id = new Types.ObjectId();
    const rows = [
      { _id, title: 'a', created_at: new Date() },
      { _id: new Types.ObjectId(), title: 'b', created_at: new Date() },
    ];
    const page = toCursorPage(rows, 1, terms, (r) => r.title);
    expect(page).toMatchObject({ items: ['a'], has_more: true });
    expect(keysetFilter(page.next_cursor as string, terms, spec)).toEqual({
      $or: [{ title: { $gt: 'a' } }, { title: 'a', _id: { $gt: _id } }],
    });
    expect(() =>
      keysetFilter(page.next_cursor as string, spec.defaultSort, spec),
    ).toThrow('invalid cursor');
  });

  it('parseIds dedupes and enforces the batch limit', () => {
    expect(parseIds('a, b,a', 5)).toEqual(['a', 'b']);
    expect(() => parseIds('a,b,c', 2)).toThrow('invalid ids');
    expect(() => parseIds('  ', 2)).toThrow('invalid ids');
  });
});
