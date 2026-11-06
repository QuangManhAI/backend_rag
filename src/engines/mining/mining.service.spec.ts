import { AppConfigService } from '../config/app-config.service';
import { parseEnv } from '../config/env.schema';
import { TEST_ENV } from '../testing/test-app';
import type { ScoredChunk } from '../types/scientific-rag';
import {
  authorityOf,
  expandTerms,
  itemToWords,
  MiningService,
  parseAuthority,
  parseRules,
  rerank,
} from './mining.service';
import { normalizeName } from './name-normalizer';

const graph = {
  top_influencers: [
    { author: 'William Li', pagerank: 0.0004 },
    { author: 'Nguyễn Văn An', pagerank: 0.0002 },
  ],
  graph_export: {
    nodes: [{ id: 'Yue Zhang', label: 'Yue Zhang', pagerank: 0.0001 }],
  },
};

const rulesJson = {
  rules: [
    {
      antecedents: ['lora'],
      consequents: ['peft', 'llm'],
      confidence: 0.9,
      lift: 3,
    },
    {
      antecedents: ['tag:large-language-models'],
      consequents: ['tag:transformer'],
      confidence: 0.5,
      lift: 2,
    },
    {
      antecedents: ['cat:cs.CL'],
      consequents: ['tag:transformer'],
      confidence: 0.99,
      lift: 9,
    },
    {
      antecedents: ['tag:transformer'],
      consequents: ['cat:cs.CL'],
      confidence: 0.99,
      lift: 9,
    },
  ],
};

const chunk = (
  paper: string,
  score: number,
  authors: string[] = [],
): ScoredChunk => ({
  chunk_id: `${paper}_c`,
  paper_id: paper,
  title: paper,
  authors,
  primary_category: 'cs.LG',
  year: 2024,
  section_title: 'Method',
  section_type: 'method',
  text: 't',
  score,
});

describe('normalizeName', () => {
  it.each([
    ['Nguyễn Văn An', 'nguyen van an'],
    ['  W.  Li et al. ', 'w li'],
    ['Yue Zhang (Tsinghua)', 'yue zhang'],
    ['Đặng Thị B', 'dang thi b'],
  ])('%p ➔ %p', (input, out) => expect(normalizeName(input)).toBe(out));
});

describe('authority', () => {
  const table = parseAuthority(graph);

  it('reads influencers and graph nodes', () => {
    expect(table.pagerank.size).toBe(3);
    expect(table.max).toBe(0.0004);
  });

  it('matches exact names after normalization', () => {
    expect(authorityOf(['William Li'], table)).toBe(1);
    expect(authorityOf(['NGUYEN VAN AN'], table)).toBe(0.5);
    expect(authorityOf(['Yue Zhang', 'nobody'], table)).toBe(0.25);
  });

  it('does not match substrings', () => {
    expect(authorityOf(['Li'], table)).toBe(0);
    expect(authorityOf(['William Lin'], table)).toBe(0);
  });

  it('no graph ➔ 0', () => {
    expect(authorityOf(['William Li'], parseAuthority(undefined))).toBe(0);
  });
});

describe('query expansion', () => {
  const rules = parseRules(rulesJson);

  it('drops rules with category antecedents and keeps only text consequents', () => {
    expect(itemToWords('cat:cs.CL')).toBeNull();
    expect(itemToWords('tag:large-language-models')).toEqual([
      'large',
      'language',
      'models',
    ]);
    expect(rules).toHaveLength(2);
  });

  it('lora fine-tuning ➔ peft, llm', () => {
    expect(expandTerms('lora fine-tuning', rules)).toEqual(['peft', 'llm']);
  });

  it('matches on word boundaries only', () => {
    expect(expandTerms('exploration strategy', rules)).toEqual([]);
    expect(expandTerms('LoRA, for LLMs?', rules)).toEqual(['peft', 'llm']);
  });

  it('matches multi-word antecedents', () => {
    expect(expandTerms('scaling large language models', rules)).toEqual([
      'transformer',
    ]);
  });

  it('skips terms already in the query, dedups, caps at 5', () => {
    expect(expandTerms('lora with peft', rules)).toEqual(['llm']);
    const many = parseRules({
      rules: Array.from({ length: 4 }, (_, i) => ({
        antecedents: ['x'],
        consequents: [`a${i}`, `b${i}`, 'dup'],
        confidence: 1,
        lift: 1,
      })),
    });
    const terms = expandTerms('x', many);
    expect(terms).toHaveLength(5);
    expect(new Set(terms).size).toBe(5);
  });
});

describe('rerank', () => {
  const table = parseAuthority(graph);

  it('final = 0.85 sim + 0.15 authority, sorted, rounded, tagged', () => {
    const out = rerank(
      [chunk('a', 0.8), chunk('b', 0.78, ['William Li'])],
      true,
      table,
    );
    expect(out.map((g) => g.paper_id)).toEqual(['b', 'a']);
    expect(out[0]).toMatchObject({
      similarity_score: 0.78,
      authority_score: 1,
      final_score: 0.813,
      citation_tag: '[Paper: b]',
      section_type: 'method',
    });
    expect(out[1].final_score).toBe(0.68);
  });

  it('without authority, final = sim', () => {
    const out = rerank(
      [chunk('a', 0.8), chunk('b', 0.78, ['William Li'])],
      false,
      table,
    );
    expect(out.map((g) => g.paper_id)).toEqual(['a', 'b']);
    expect(out[1]).toMatchObject({ authority_score: 0, final_score: 0.78 });
  });

  it('rounds to 4 digits', () => {
    expect(rerank([chunk('a', 0.123456789)], false, table)[0].final_score).toBe(
      0.1235,
    );
  });
});

describe('MiningService', () => {
  it('missing files ➔ no authority, no expansion, no crash', async () => {
    const config = new AppConfigService(
      parseEnv({
        ...TEST_ENV,
        MONGO_URI: 'mongodb://x',
        MINING_DIR: '/nonexistent',
      }),
    );
    const s = new MiningService(config);
    await s.onModuleInit();
    expect(s.getAuthorityScore(['William Li'])).toBe(0);
    expect(s.expandQueryTerms('lora')).toEqual([]);
  });
});
