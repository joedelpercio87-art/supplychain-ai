# Policy retrieval

The local policy retrieval layer loads Markdown files only from the project
`documents/` directory, splits them into heading-aware chunks, and embeds those
chunks with OpenAI's `text-embedding-3-small` model. It stores the vectors and
chunk metadata in `data/vector-index/policy-index.json`, which is ignored by
Git. Search embeds a query and ranks the local index with cosine similarity.

Run `npm run rag:index` to create or refresh the local index, and
`npm run rag:test` to run the three policy retrieval examples. The retrieval
API is exported from `src/context/index.ts`; it is not connected to the main
agent.
