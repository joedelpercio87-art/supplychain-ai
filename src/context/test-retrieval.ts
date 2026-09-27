import { searchCompanyPolicies, summarizeEmbeddingError } from './retrieval.ts';

const queries = [
  'What happens when a supplier is more than 10 days late?',
  'What should we do when inventory remains below safety stock?',
  'When does poor OTIF require corrective action?',
];

async function main(): Promise<void> {
  for (const query of queries) {
    const results = await searchCompanyPolicies(query, { topK: 3 });
    console.log(JSON.stringify({
      query,
      results: results.map((result, index) => ({
        rank: index + 1,
        document: result.document,
        section: result.section,
        chunkId: result.chunkId,
        similarity: Number(result.similarity.toFixed(4)),
        preview: result.text.replace(/\s+/g, ' ').slice(0, 220),
      })),
    }, null, 2));
  }
}

main().catch((error: unknown) => {
  console.error(summarizeEmbeddingError(error));
  process.exitCode = 1;
});
