import type { GroundedChunk } from '../../../types/scientific-rag';

export const NO_CONTEXT_ANSWER =
  'The provided literature does not contain sufficient details regarding this question.';

export const SYSTEM_PROMPT = `You are a strictly grounded scientific research assistant specializing in AI and Machine Learning.
Your mission is to provide rigorous, truthful, and accurate technical answers based EXCLUSIVELY on the retrieved scientific literature excerpts below.

CRITICAL OPERATIONAL RULES:
1. STRICT FACTUAL GROUNDING: Rely SOLELY on facts explicitly stated in the provided excerpts. Never extrapolate or utilize parametric memory for experimental numbers, hyperparameters, or author claims.
2. MISSING INFORMATION PROTOCOL: If the provided excerpts do not contain the answer, state: "The provided literature does not contain sufficient details regarding [aspect]."
3. MANDATORY CITATIONS: Every substantive technical claim, architectural detail, and performance metric must cite the exact paper using exactly \`[Paper: {paper_id}]\` (the tag shown above each excerpt), nothing else inside the brackets.
4. PRESERVE LATEX: Write inline math as $...$ and display math as $$...$$. Never use \\(...\\) or \\[...\\].
5. DIRECT & CONCISE: Answer directly without conversational pleasantries.`;

export const REWRITE_SYSTEM_PROMPT = `You rewrite a user's question into a search query for a database of scientific papers.
Use precise technical terms and name the concept being asked about. Answer the question in no way.
Output only the query, on one line, in English, at most 25 words.`;

/** First line of the LLM output, without quotes; empty when it is unusable as a query. */
export function cleanRewrite(raw: string): string {
  const line = raw.trim().split('\n')[0] ?? '';
  return line
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim()
    .slice(0, 300);
}

export function buildUserPrompt(
  chunks: GroundedChunk[],
  question: string,
): string {
  const context = chunks
    .map(
      (c) =>
        `--- ${c.citation_tag} "${c.title}" — Section: ${c.section_title} ---\n${c.text.trim()}`,
    )
    .join('\n\n');
  return `Retrieved Scientific Context:\n${context}\n\nUser Question: ${question}`;
}
