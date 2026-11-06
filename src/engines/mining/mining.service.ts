import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { AppConfigService } from '../config/app-config.service';
import {
  GroundedChunk,
  ScoredChunk,
  toSectionType,
} from '../types/scientific-rag';
import { normalizeName, tokenize } from './name-normalizer';

export const SIMILARITY_WEIGHT = 0.85;
export const AUTHORITY_WEIGHT = 0.15;
export const MAX_EXPANSION_TERMS = 5;

/** A rule whose antecedents and consequents are word sequences (already tokenized). */
export interface TextRule {
  antecedents: string[][];
  consequents: string[][];
  score: number;
}

export interface AuthorityTable {
  pagerank: Map<string, number>;
  max: number;
}

export const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null;

/**
 * Authors with a PageRank, from `top_influencers` and `graph_export.nodes` of
 * graph_coauthorship.json. Names are normalized; the highest PageRank wins on duplicates.
 */
export function parseAuthority(raw: unknown): AuthorityTable {
  const pagerank = new Map<string, number>();
  if (!isObj(raw)) return { pagerank, max: 0 };
  const lists: unknown[] = [raw.top_influencers, raw.influencers];
  if (isObj(raw.graph_export)) lists.push(raw.graph_export.nodes);
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!isObj(item)) continue;
      const name = item.author ?? item.label ?? item.name ?? item.id;
      const pr = Number(item.pagerank ?? item.score);
      if (typeof name !== 'string' || !(pr > 0)) continue;
      const key = normalizeName(name);
      if (key && pr > (pagerank.get(key) ?? 0)) pagerank.set(key, pr);
    }
  }
  return { pagerank, max: Math.max(0, ...pagerank.values()) };
}

/** `tag:large-language-models` ➔ ["large","language","models"]; `cat:*` is not text ➔ null. */
export function itemToWords(item: string): string[] | null {
  const m = /^([a-z]+):(.*)$/.exec(item);
  if (m && m[1] !== 'tag') return null;
  const words = tokenize(m ? m[2] : item);
  return words.length ? words : null;
}

/** Text rules from association_rules.json, strongest first (confidence × lift). */
export function parseRules(raw: unknown): TextRule[] {
  const list = isObj(raw) ? (raw.rules ?? raw.association_rules) : raw;
  if (!Array.isArray(list)) return [];
  const out: TextRule[] = [];
  for (const r of list) {
    if (
      !isObj(r) ||
      !Array.isArray(r.antecedents) ||
      !Array.isArray(r.consequents)
    )
      continue;
    const ants = r.antecedents.map((a) =>
      typeof a === 'string' ? itemToWords(a) : null,
    );
    const cons = r.consequents.map((c) =>
      typeof c === 'string' ? itemToWords(c) : null,
    );
    if (!ants.length || ants.some((a) => a === null)) continue;
    const textCons = cons.filter((c): c is string[] => c !== null);
    if (!textCons.length) continue;
    const score = Number(r.confidence ?? 0) * Number(r.lift ?? 1);
    out.push({ antecedents: ants as string[][], consequents: textCons, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** True when `phrase` occurs as consecutive whole tokens of `tokens`. */
export function containsPhrase(tokens: string[], phrase: string[]): boolean {
  outer: for (let i = 0; i + phrase.length <= tokens.length; i++) {
    for (let j = 0; j < phrase.length; j++) {
      if (tokens[i + j] !== phrase[j]) continue outer;
    }
    return true;
  }
  return false;
}

/** Consequent terms of every rule whose antecedents all appear as whole words in the query. */
export function expandTerms(query: string, rules: TextRule[]): string[] {
  const tokens = tokenize(query);
  const out: string[] = [];
  for (const rule of rules) {
    if (!rule.antecedents.every((a) => containsPhrase(tokens, a))) continue;
    for (const c of rule.consequents) {
      const term = c.join(' ');
      if (containsPhrase(tokens, c) || out.includes(term)) continue;
      out.push(term);
      if (out.length >= MAX_EXPANSION_TERMS) return out;
    }
  }
  return out;
}

/** Best normalized PageRank among the authors, by exact normalized name, in [0, 1]. */
export function authorityOf(authors: string[], table: AuthorityTable): number {
  if (table.max <= 0) return 0;
  let best = 0;
  for (const a of authors) {
    const pr = table.pagerank.get(normalizeName(a)) ?? 0;
    if (pr > best) best = pr;
  }
  return Math.min(1, best / table.max);
}

/** `final = 0.85·sim + 0.15·authority` (or `sim` alone), rounded to 4 digits, best first. */
export function rerank(
  chunks: ScoredChunk[],
  useAuthority: boolean,
  table: AuthorityTable,
): GroundedChunk[] {
  return chunks
    .map((c) => {
      const authority = useAuthority ? authorityOf(c.authors, table) : 0;
      const final = useAuthority
        ? SIMILARITY_WEIGHT * c.score + AUTHORITY_WEIGHT * authority
        : c.score;
      return {
        chunk_id: c.chunk_id,
        paper_id: c.paper_id,
        title: c.title,
        section_title: c.section_title,
        section_type: toSectionType(c.section_type),
        text: c.text,
        similarity_score: round4(c.score),
        authority_score: round4(authority),
        final_score: round4(final),
        citation_tag: `[Paper: ${c.paper_id}]`,
        exact: final,
      };
    })
    .sort((a, b) => b.exact - a.exact)
    .map(({ exact: _exact, ...g }) => g);
}

@Injectable()
export class MiningService implements OnModuleInit {
  private readonly logger = new Logger(MiningService.name);
  private authority: AuthorityTable = { pagerank: new Map(), max: 0 };
  private rules: TextRule[] = [];

  constructor(private readonly config: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    const dir = this.config.get('MINING_DIR');
    const graph = await this.readJson(join(dir, 'graph_coauthorship.json'));
    if (graph !== undefined) this.authority = parseAuthority(graph);
    const rules = await this.readJson(join(dir, 'association_rules.json'));
    if (rules !== undefined) this.rules = parseRules(rules);
    this.logger.log(
      { authors: this.authority.pagerank.size, text_rules: this.rules.length },
      'MINING_LOADED',
    );
  }

  getAuthorityScore(authors: string[]): number {
    return authorityOf(authors, this.authority);
  }

  expandQueryTerms(query: string): string[] {
    return expandTerms(query, this.rules);
  }

  rerank(chunks: ScoredChunk[], useAuthority: boolean): GroundedChunk[] {
    return rerank(chunks, useAuthority, this.authority);
  }

  /** Test hook / hot reload. */
  load(graph: unknown, rules: unknown): void {
    this.authority = parseAuthority(graph);
    this.rules = parseRules(rules);
  }

  private async readJson(path: string): Promise<unknown> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as unknown;
    } catch (e) {
      this.logger.warn(
        { path, err: e },
        'MINING_FILE_MISSING: falling back to no authority / no expansion',
      );
      return undefined;
    }
  }
}
