# Application

Place the application entry point and user interface here once the runtime and interface have been selected.
# SupplyChain AI local dashboard

Run `npm run dev` from the project root. The Vite UI is available at
`http://127.0.0.1:5173`; the local API listens on `127.0.0.1:5175` and is
proxied by Vite. Both bind to loopback only.

The API starts the existing stdio MCP server as a child process. Dashboard
metrics and investigations call the discovered MCP tools; operational SQL and
policy retrieval remain in their existing layers. Investigation responses
include the agent answer and a sanitized trace/evidence summary, never hidden
reasoning or embedding vectors.

Use `npm run typecheck`, `npm run ui:lint`, and `npm run build` to validate the
TypeScript, UI lint, and production frontend build.
