# Agent orchestration

`supplyChainAgent.ts` owns the Responses API loop and exposes only the five existing read-only tools. It passes the user's question, general evidence-handling instructions, tool schemas, and requested tool outputs to the model. It does not load database contents into the prompt. Tool arguments are checked and routed through the existing `src/tools` interfaces; raw SQL is not exposed.

The loop is capped at six tool-call rounds and 18 total tool calls. Development logs include the question, tool names, whitelisted arguments, compact result summaries, and round count. API keys and full tool result payloads are not logged.

Run `npm run agent:test` to ask the August 2026 OTIF question against the local SQLite-backed tools. The Node script loads `OPENAI_API_KEY` from the ignored project `.env` file.
