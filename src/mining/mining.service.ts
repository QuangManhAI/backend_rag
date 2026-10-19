import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  AssociationRule,
  GroundedChunkResult,
  ScientificChunk,
} from '../types/scientific-rag';

@Injectable()
export class MiningService implements OnModuleInit {
  private readonly logger = new Logger(MiningService.name);
  private influencers: Map<string, number> = new Map();
  private maxPageRank: number = 0.012632;
  private rules: AssociationRule[] = [];

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.loadMiningArtifacts();
  }

  private async loadMiningArtifacts(): Promise<void> {
    const miningPath =
      this.configService.get<string>('MINING_PATH') || '../data/gold/mining';
    const r2PublicUrl = this.configService.get<string>('R2_PUBLIC_URL');

    // 1. Load PageRank Co-Authorship Graph
    await this.loadCoauthorship(miningPath, r2PublicUrl);

    // 2. Load Association Rules (FP-Growth)
    await this.loadAssociationRules(miningPath, r2PublicUrl);
  }

  private async loadCoauthorship(localDir: string, r2PublicUrl?: string): Promise<void> {
    const candidates = [
      path.resolve(process.cwd(), localDir, 'graph_coauthorship.json'),
      path.resolve(process.cwd(), '../data/gold/mining/graph_coauthorship.json'),
      'C:\\document\\Study documents\\Uth-Data-Mining\\data\\gold\\mining\\graph_coauthorship.json',
    ];

    let loaded = false;
    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        try {
          const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          this.parseInfluencers(content);
          this.logger.log(`Loaded PageRank graph from local file: ${filePath}`);
          loaded = true;
          break;
        } catch (e) {
          this.logger.warn(`Failed to parse local file ${filePath}: ${(e as Error).message}`);
        }
      }
    }

    if (!loaded && r2PublicUrl) {
      const url = `${r2PublicUrl.replace(/\/$/, '')}/gold/mining/graph_coauthorship.json`;
      try {
        this.logger.log(`Fetching PageRank graph from Cloudflare R2: ${url}`);
        const res = await fetch(url);
        if (res.ok) {
          const content = await res.json();
          this.parseInfluencers(content);
          this.logger.log(`Successfully loaded PageRank graph from R2`);
          loaded = true;
        }
      } catch (err) {
        this.logger.warn(`Failed to fetch PageRank graph from R2: ${(err as Error).message}`);
      }
    }

    if (!loaded) {
      this.logger.warn('Could not load graph_coauthorship.json. Using fallback default values.');
    }
  }

  private parseInfluencers(content: any): void {
    const influencersList = content.top_influencers || content.influencers || [];
    let highestPr = 0;

    for (const item of influencersList) {
      const name = (item.author || item.name || '').trim().toLowerCase();
      const pr = Number(item.pagerank ?? item.score ?? 0);
      if (name && pr > 0) {
        this.influencers.set(name, pr);
        if (pr > highestPr) highestPr = pr;
      }
    }

    if (highestPr > 0) {
      this.maxPageRank = highestPr;
    }
    this.logger.log(
      `Parsed ${this.influencers.size} influencers (max PageRank: ${this.maxPageRank})`,
    );
  }

  private async loadAssociationRules(localDir: string, r2PublicUrl?: string): Promise<void> {
    const candidates = [
      path.resolve(process.cwd(), localDir, 'association_rules.json'),
      path.resolve(process.cwd(), '../data/gold/mining/association_rules.json'),
      'C:\\document\\Study documents\\Uth-Data-Mining\\data\\gold\\mining\\association_rules.json',
    ];

    let loaded = false;
    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        try {
          const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          this.rules = content.rules || content.association_rules || [];
          this.logger.log(`Loaded ${this.rules.length} association rules from ${filePath}`);
          loaded = true;
          break;
        } catch (e) {
          this.logger.warn(`Failed to parse rules from ${filePath}: ${(e as Error).message}`);
        }
      }
    }

    if (!loaded && r2PublicUrl) {
      const url = `${r2PublicUrl.replace(/\/$/, '')}/gold/mining/association_rules.json`;
      try {
        this.logger.log(`Fetching association rules from Cloudflare R2: ${url}`);
        const res = await fetch(url);
        if (res.ok) {
          const content = await res.json();
          this.rules = content.rules || content.association_rules || [];
          this.logger.log(`Successfully loaded ${this.rules.length} rules from R2`);
          loaded = true;
        }
      } catch (err) {
        this.logger.warn(`Failed to fetch association rules from R2: ${(err as Error).message}`);
      }
    }

    if (!loaded) {
      this.logger.warn('Could not load association_rules.json. Rule expansion will be inactive.');
    }
  }

  /**
   * Calculate normalized PageRank authority score in [0.0, 1.0].
   */
  getAuthorityScore(authors: string[]): number {
    if (!authors || authors.length === 0 || this.influencers.size === 0) {
      return 0.0;
    }

    let maxPr = 0.0;
    for (const author of authors) {
      const clean = author.toLowerCase().replace(/et\s+al\.?/g, '').trim();
      for (const [infName, pr] of this.influencers.entries()) {
        if (clean.includes(infName) || infName.includes(clean)) {
          if (pr > maxPr) maxPr = pr;
        }
      }
    }

    if (maxPr === 0.0) return 0.0;
    return Math.min(1.0, maxPr / this.maxPageRank);
  }

  /**
   * Expand query terms using frequent co-occurrence antecedents.
   */
  expandQueryTerms(query: string): string[] {
    if (!query || this.rules.length === 0) return [];

    const qLower = query.toLowerCase();
    const expansions = new Set<string>();

    for (const rule of this.rules) {
      const matches = rule.antecedents.some((ant) => qLower.includes(ant.toLowerCase()));
      if (matches) {
        for (const con of rule.consequents) {
          if (!qLower.includes(con.toLowerCase())) {
            expansions.add(con);
          }
        }
      }
    }

    return Array.from(expansions);
  }

  /**
   * Blended rerank: 85% vector similarity + 15% authority boost.
   */
  rerankChunks(
    chunks: ScientificChunk[],
    useAuthorityBoost: boolean = true,
  ): GroundedChunkResult[] {
    const scored: GroundedChunkResult[] = chunks.map((chunk) => {
      const cosineDist = chunk._distance ?? 0.5;
      const simScore = Math.max(0, 1 - cosineDist);
      const authScore = useAuthorityBoost ? this.getAuthorityScore(chunk.authors) : 0;
      const finalScore = 0.85 * simScore + 0.15 * authScore;

      return {
        chunk_id: chunk.chunk_id,
        paper_id: chunk.paper_id,
        title: chunk.title,
        authors: chunk.authors,
        section_title: chunk.section_title,
        text: chunk.text,
        similarity_score: Number(simScore.toFixed(4)),
        authority_score: authScore > 0 ? Number(authScore.toFixed(4)) : undefined,
        final_score: Number(finalScore.toFixed(4)),
        citation_tag: `[Paper: ${chunk.paper_id}]`,
      };
    });

    // Sort descending by final_score
    scored.sort((a, b) => b.final_score - a.final_score);
    return scored;
  }
}
