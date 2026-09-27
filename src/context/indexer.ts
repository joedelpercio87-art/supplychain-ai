import OpenAI from 'openai';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicyChunks, type PolicyChunk } from './documents.ts';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const VECTOR_INDEX_PATH = resolve(PROJECT_ROOT, 'data/vector-index/policy-index.json');
const EMBEDDING_BATCH_SIZE = 64;

export interface IndexedPolicyChunk extends PolicyChunk {
  embedding: number[];
}

export interface PolicyIndex {
  schemaVersion: 1;
  embeddingModel: string;
  createdAt: string;
  documentCount: number;
  chunks: IndexedPolicyChunk[];
}

export function requireOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key || /^(your_key_goes_here|your_openai_api_key_here)$/i.test(key)) {
    throw new Error('OPENAI_API_KEY is missing or is a placeholder. Set a valid key in the project .env file.');
  }
  return key;
}

export function summarizeEmbeddingError(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as { name?: unknown; status?: unknown; code?: unknown; cause?: unknown; message?: unknown };
    const name = typeof candidate.name === 'string' ? candidate.name : 'Error';
    if (name.includes('Connection') || name.includes('Timeout') || name === 'FetchError') {
      return `OpenAI API connection failed (${name}). Check network access and API availability.`;
    }
    if (name === 'AuthenticationError' || candidate.status === 401) return 'OpenAI authentication failed. Check that OPENAI_API_KEY is valid.';
    if (name === 'PermissionDeniedError' || candidate.status === 403) return 'OpenAI permission denied (HTTP 403). Check project access to the embedding model.';
    if (name === 'RateLimitError' || candidate.status === 429) return 'OpenAI rate limit or quota error (HTTP 429). Check project limits and billing.';
    if (typeof candidate.status === 'number') return `OpenAI API request failed with HTTP status ${candidate.status} (${name}).`;
    if (candidate.code === 'ENOENT') return 'A required local file or directory was not found.';
    if (name === 'RangeError' && typeof candidate.message === 'string') {
      const key = process.env.OPENAI_API_KEY;
      const safeMessage = key ? candidate.message.replaceAll(key, '[redacted]') : candidate.message;
      return `Policy retrieval operation failed (RangeError): ${safeMessage.slice(0, 180)}`;
    }
    if (candidate.cause && typeof candidate.cause === 'object') {
      const cause = candidate.cause as { code?: unknown; name?: unknown };
      if (typeof cause.code === 'string' && ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(cause.code)) {
        return `OpenAI API connection failed (${cause.code}). Check network access and API availability.`;
      }
    }
    return `Policy retrieval operation failed (${name}). Inspect local configuration and retry.`;
  }
  return 'Policy retrieval operation failed. Inspect the local configuration and retry.';
}

export async function createEmbeddings(inputs: string[]): Promise<number[][]> {
  const client = new OpenAI({ apiKey: requireOpenAIKey() });
  const vectors: number[][] = [];
  for (let offset = 0; offset < inputs.length; offset += EMBEDDING_BATCH_SIZE) {
    const batch = inputs.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
      encoding_format: 'float',
    });
    const ordered = [...response.data].sort((a, b) => a.index - b.index);
    if (ordered.length !== batch.length) throw new Error('Embedding response count did not match submitted chunks.');
    vectors.push(...ordered.map((item) => item.embedding));
  }
  return vectors;
}

export async function buildPolicyIndex(): Promise<PolicyIndex> {
  const { documentCount, chunks } = await loadPolicyChunks();
  const vectors = await createEmbeddings(chunks.map((chunk) =>
    `Document: ${chunk.documentTitle}\nSection: ${chunk.section}\n\n${chunk.text}`));
  const index: PolicyIndex = {
    schemaVersion: 1,
    embeddingModel: EMBEDDING_MODEL,
    createdAt: new Date().toISOString(),
    documentCount,
    chunks: chunks.map((chunk, position) => ({ ...chunk, embedding: vectors[position]! })),
  };
  await mkdir(dirname(VECTOR_INDEX_PATH), { recursive: true });
  const temporaryPath = `${VECTOR_INDEX_PATH}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(index)}\n`, 'utf8');
  await rename(temporaryPath, VECTOR_INDEX_PATH);
  return index;
}

async function main(): Promise<void> {
  const index = await buildPolicyIndex();
  console.log(JSON.stringify({
    status: 'indexed',
    embeddingModel: index.embeddingModel,
    documentCount: index.documentCount,
    chunkCount: index.chunks.length,
    indexPath: 'data/vector-index/policy-index.json',
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    console.error(summarizeEmbeddingError(error));
    process.exitCode = 1;
  });
}
