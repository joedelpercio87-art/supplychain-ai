import { readFile } from 'node:fs/promises';
import OpenAI from 'openai';
import { EMBEDDING_MODEL, requireOpenAIKey, summarizeEmbeddingError, VECTOR_INDEX_PATH, type PolicyIndex } from './indexer.ts';

export interface SearchCompanyPoliciesOptions {
  topK?: number;
  minSimilarity?: number;
}

export interface PolicySearchResult {
  document: string;
  documentTitle: string;
  section: string;
  chunkId: string;
  text: string;
  similarity: number;
}

function validateQueryAndOptions(query: string, options: SearchCompanyPoliciesOptions): { topK: number; minSimilarity: number } {
  if (typeof query !== 'string' || !query.trim()) throw new Error('query must be a non-empty string.');
  if (query.length > 4000) throw new Error('query must not exceed 4000 characters.');
  const topK = options.topK ?? 3;
  const minSimilarity = options.minSimilarity ?? -1;
  if (!Number.isInteger(topK) || topK < 1 || topK > 50) throw new Error('topK must be an integer between 1 and 50.');
  if (!Number.isFinite(minSimilarity) || minSimilarity < -1 || minSimilarity > 1) {
    throw new Error('minSimilarity must be a finite number between -1 and 1.');
  }
  return { topK, minSimilarity };
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) throw new Error('Embedding dimensions do not match.');
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i]!;
    const b = right[i]!;
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('Index contains an invalid embedding vector.');
    dot += a * b;
    leftMagnitude += a * a;
    rightMagnitude += b * b;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

async function readPolicyIndex(): Promise<PolicyIndex> {
  const raw = await readFile(VECTOR_INDEX_PATH, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') throw new Error('Policy vector index has an invalid format.');
  const index = parsed as Partial<PolicyIndex>;
  if (index.schemaVersion !== 1 || index.embeddingModel !== EMBEDDING_MODEL || !Array.isArray(index.chunks)) {
    throw new Error('Policy vector index is incompatible. Rebuild it with npm run rag:index.');
  }
  return index as PolicyIndex;
}

export async function searchCompanyPolicies(
  query: string,
  options: SearchCompanyPoliciesOptions = {},
): Promise<PolicySearchResult[]> {
  const { topK, minSimilarity } = validateQueryAndOptions(query, options);
  const index = await readPolicyIndex();
  const client = new OpenAI({ apiKey: requireOpenAIKey() });
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: query.trim(),
    encoding_format: 'float',
  });
  const queryVector = response.data[0]?.embedding;
  if (!queryVector) throw new Error('OpenAI returned no query embedding.');
  return index.chunks.map((chunk) => ({
    document: chunk.document,
    documentTitle: chunk.documentTitle,
    section: chunk.section,
    chunkId: chunk.chunkId,
    text: chunk.text,
    similarity: cosineSimilarity(queryVector, chunk.embedding),
  }))
    .filter((result) => result.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

export { summarizeEmbeddingError };
