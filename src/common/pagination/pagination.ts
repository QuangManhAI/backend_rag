import { BadRequestException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Types } from 'mongoose';
import { escapeRegex } from '../security/sanitize';
import { isUuid } from '../utils/uuid';

export const INVALID_CURSOR = 'invalid cursor';

/** One page of a cursor-paginated list (API_DESIGN §1.4). */
export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export function encodeCursor(obj: object): string {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

/**
 * Decodes an opaque cursor; `isValid` checks its shape. Anything malformed ➔ 400 `invalid cursor`.
 */
export function decodeCursor<T>(
  str: string,
  isValid: (v: unknown) => v is T,
): T {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(str)) throw new Error('bad alphabet');
    const obj: unknown = JSON.parse(
      Buffer.from(str, 'base64url').toString('utf8'),
    );
    if (!isValid(obj)) throw new Error('bad shape');
    return obj;
  } catch {
    throw new BadRequestException(INVALID_CURSOR);
  }
}

export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @Max(50, { message: 'limit must be between 1 and 50' })
  @Min(1, { message: 'limit must be between 1 and 50' })
  @IsInt({ message: 'limit must be an integer' })
  limit: number = 20;

  @ApiPropertyOptional({ description: 'Opaque cursor from `next_cursor`' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

// ------------------------------------------------------------------ query language (API_DESIGN §1.5)

export const INVALID_SORT = 'invalid sort';
export const INVALID_IDS = 'invalid ids';
const MAX_SORT_TERMS = 3;

export type FieldType = 'date' | 'string' | 'number' | 'boolean' | 'objectId';
export type IdType = 'uuid' | 'objectId';
export type SortDirection = 'asc' | 'desc';
export type MongoFilter = Record<string, unknown>;

export interface SortTerm {
  field: string;
  dir: SortDirection;
}

/** What one list endpoint exposes. Fields outside this spec can never reach MongoDB. */
export interface ListSpec {
  sortable: Record<string, FieldType>;
  defaultSort: SortTerm[];
  idType: IdType;
}

export interface FilterField {
  type: FieldType;
  /** The document path, when the query name differs from it (`role` ➔ `roles`). */
  path?: string;
  /** Allowed operators; defaults to the ones that make sense for `type`. */
  ops?: FilterOp[];
  /** Closed set of values (enums). */
  values?: readonly string[];
}

export type FilterOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'match';

const RANGE_OPS: FilterOp[] = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'];
const DEFAULT_OPS: Record<FieldType, FilterOp[]> = {
  date: RANGE_OPS,
  number: RANGE_OPS,
  string: ['eq', 'ne', 'match'],
  boolean: ['eq', 'ne'],
  objectId: ['eq', 'ne'],
};

function parseValue(type: FieldType, raw: string): unknown {
  switch (type) {
    case 'date': {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) throw new Error('bad date');
      return d;
    }
    case 'number': {
      const n = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(n))
        throw new Error('bad number');
      return n;
    }
    case 'boolean':
      if (raw !== 'true' && raw !== 'false') throw new Error('bad boolean');
      return raw === 'true';
    case 'objectId':
      if (!Types.ObjectId.isValid(raw)) throw new Error('bad object id');
      return new Types.ObjectId(raw);
    default:
      return raw;
  }
}

/** `sort=title:asc,created_at:desc`; a bare field sorts ascending. Unknown fields ➔ 400. */
export function parseSort(raw: string | undefined, spec: ListSpec): SortTerm[] {
  if (!raw) return spec.defaultSort;
  const terms = raw.split(',').map((part): SortTerm => {
    const [field, dir = 'asc', extra] = part.split(':');
    if (
      extra !== undefined ||
      !Object.hasOwn(spec.sortable, field) ||
      (dir !== 'asc' && dir !== 'desc')
    ) {
      throw new BadRequestException(INVALID_SORT);
    }
    return { field, dir };
  });
  const unique = new Set(terms.map((t) => t.field));
  if (terms.length > MAX_SORT_TERMS || unique.size !== terms.length) {
    throw new BadRequestException(INVALID_SORT);
  }
  return terms;
}

/** The sort terms plus `_id` as the tie-break that makes the order total. */
export function mongoSort(terms: SortTerm[]): Record<string, 1 | -1> {
  const out: Record<string, 1 | -1> = {};
  for (const t of terms) out[t.field] = t.dir === 'asc' ? 1 : -1;
  out._id = terms.at(-1)?.dir === 'asc' ? 1 : -1;
  return out;
}

const sortKey = (terms: SortTerm[]) =>
  terms.map((t) => `${t.field}:${t.dir}`).join(',');

interface KeysetCursor {
  s: string;
  v: unknown[];
  id: string;
}

const isKeysetCursor = (v: unknown): v is KeysetCursor => {
  const c = v as KeysetCursor;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof c.s === 'string' &&
    typeof c.id === 'string' &&
    Array.isArray(c.v)
  );
};

/**
 * Keyset condition for "rows after the cursor". The cursor is bound to its sort order: reusing it
 * with another `sort` ➔ 400 `invalid cursor`, instead of silently skipping or repeating rows.
 */
export function keysetFilter(
  raw: string,
  terms: SortTerm[],
  spec: ListSpec,
): MongoFilter {
  const c = decodeCursor(raw, isKeysetCursor);
  if (c.s !== sortKey(terms) || c.v.length !== terms.length) {
    throw new BadRequestException(INVALID_CURSOR);
  }
  let id: unknown;
  let values: unknown[];
  try {
    if (spec.idType === 'uuid' && !isUuid(c.id)) throw new Error('bad id');
    id = parseValue(spec.idType === 'uuid' ? 'string' : 'objectId', c.id);
    values = terms.map((t, i) =>
      parseValue(spec.sortable[t.field], String(c.v[i])),
    );
  } catch {
    throw new BadRequestException(INVALID_CURSOR);
  }
  const or: MongoFilter[] = [];
  const equal: MongoFilter = {};
  terms.forEach((t, i) => {
    const op = t.dir === 'asc' ? '$gt' : '$lt';
    or.push({ ...equal, [t.field]: { [op]: values[i] } });
    equal[t.field] = values[i];
  });
  const idOp = terms.at(-1)?.dir === 'asc' ? '$gt' : '$lt';
  or.push({ ...equal, _id: { [idOp]: id } });
  return { $or: or };
}

/** One `limit + 1` result set ➔ the page envelope every list endpoint returns. */
export function toCursorPage<R extends object, T>(
  rows: R[],
  limit: number,
  terms: SortTerm[],
  map: (row: R) => T,
): { items: T[]; next_cursor: string | null; has_more: boolean } {
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1) as
    (Record<string, unknown> & { _id: unknown }) | undefined;
  return {
    items: page.map(map),
    next_cursor:
      hasMore && last
        ? encodeCursor({
            s: sortKey(terms),
            v: terms.map((t) => {
              const v = last[t.field] ?? last.created_at;
              return v instanceof Date ? v.toISOString() : v;
            }),
            id: String(last._id),
          })
        : null,
    has_more: hasMore,
  };
}

/**
 * One filter parameter: `value` (same as `eq:value`), `op:value` or several comparisons joined with
 * commas (`gt:20,lt:50`). `match` is a case-insensitive literal substring and takes the whole rest
 * of the value. The result only ever holds whitelisted operators and typed values.
 */
export function parseFilter(
  name: string,
  raw: string,
  field: FilterField,
): MongoFilter {
  const invalid = () => new BadRequestException(`invalid filter: ${name}`);
  const allowed = field.ops ?? DEFAULT_OPS[field.type];
  const path = field.path ?? name;
  if (raw.startsWith('match:')) {
    const text = raw.slice('match:'.length).trim();
    if (!allowed.includes('match') || !text) throw invalid();
    return { [path]: { $regex: escapeRegex(text), $options: 'i' } };
  }
  const condition: MongoFilter = {};
  for (const part of raw.split(',')) {
    const colon = part.indexOf(':');
    const prefix = colon === -1 ? '' : part.slice(0, colon);
    const hasOp = (allowed as string[]).includes(prefix);
    if (!hasOp && (RANGE_OPS as string[]).includes(prefix)) throw invalid();
    const op = hasOp ? (prefix as FilterOp) : 'eq';
    const text = hasOp ? part.slice(colon + 1) : part;
    if (!allowed.includes(op) || !text) throw invalid();
    if (field.values && !field.values.includes(text)) throw invalid();
    try {
      condition[`$${op}`] = parseValue(field.type, text);
    } catch {
      throw invalid();
    }
  }
  return { [path]: condition };
}

/** Parses every filter present in `query`; only names listed in `fields` are ever read. */
export function parseFilters(
  query: object,
  fields: Record<string, FilterField>,
): MongoFilter[] {
  const q = query as Record<string, unknown>;
  return Object.entries(fields).flatMap(([name, field]) => {
    const raw = q[name];
    return typeof raw === 'string' && raw !== ''
      ? [parseFilter(name, raw, field)]
      : [];
  });
}

/** Combines conditions without ever emitting the empty `$and` MongoDB refuses. */
export function allOf(
  base: MongoFilter,
  conditions: MongoFilter[],
): MongoFilter {
  return conditions.length ? { ...base, $and: conditions } : base;
}

/** `ids=a,b,c` ➔ the unique ids. Empty, too many or malformed ➔ 400 `invalid ids`. */
export function parseIds(
  raw: string,
  max: number,
  isValid: (id: string) => boolean = (id) => id.length > 0,
): string[] {
  const ids = [...new Set(raw.split(',').map((id) => id.trim()))];
  if (!raw.trim() || ids.length > max || !ids.every((id) => isValid(id))) {
    throw new BadRequestException(INVALID_IDS);
  }
  return ids;
}

/** The query every list endpoint shares. */
export class ListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Comma-separated `field:asc|desc` terms',
    example: 'created_at:desc',
  })
  @IsOptional()
  @IsString({ message: INVALID_SORT })
  @MaxLength(120, { message: INVALID_SORT })
  sort?: string;
}

/** Required `ids` of a batch endpoint. */
export class BatchIdsQueryDto {
  @ApiProperty({ description: 'Comma-separated ids', example: 'id1,id2,id3' })
  @IsString({ message: INVALID_IDS })
  @MaxLength(4096, { message: INVALID_IDS })
  ids: string;
}
