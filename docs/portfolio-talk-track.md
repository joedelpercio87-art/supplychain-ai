# Portfolio Talk Track

Use this as a concise guide to explaining the project. Keep claims tied to the implementation in this repository: it is a local synthetic demonstration, not a deployed enterprise platform.

## 30-second explanation

SupplyChain AI is a local operations-intelligence demo. A user asks a question about service performance, and an OpenAI-backed agent decides which read-only business tools and policy passages it needs. The capabilities are discovered and called through a local MCP server. Business metrics come from synthetic SQLite data; policy guidance comes from section-aware semantic retrieval over Markdown documents. The UI shows the answer, evidence, policy sources, and observable tool activity without exposing hidden reasoning.

## 2-minute architecture explanation

The React/Vite dashboard sends questions to a loopback Express API. The API runs a local agent orchestration loop using the OpenAI Responses API and an MCP client over stdio. The agent discovers tool schemas from the SupplyChain MCP server rather than embedding business logic in the agent. The MCP server is a thin adapter around deterministic TypeScript tools and the existing policy-search function.

The business tools validate bounded inputs and call fixed, parameterized, read-only SQL queries against SQLite. For policy questions, the search capability embeds the query, ranks a local index with cosine similarity, and returns a small set of Markdown passages with document and section metadata. The model sees only the question, instructions, tool definitions, and results it asks for. The loop has round and total-call limits. The UI shows the answer and sanitized metadata such as tool sequence, evidence summaries, and policy citations.

The repository also keeps a direct-tool agent. That makes it possible to compare a direct application integration with an MCP protocol boundary while reusing the same underlying capabilities.

## What is context engineering?

Context engineering is deciding what information and capabilities should be available to a model for a particular task, and how those inputs should be selected and presented. In this project, the entire database and policy library are not pasted into a prompt. The agent can request specific governed tools, and only the returned results enter its working context. Operational observations and retrieved policy are labeled separately so that synthesis can retain provenance.

## Why MCP instead of only function calling?

Direct function tools are simpler for a single application with a stable tool set, and the repository retains that architecture. MCP adds standardized discovery and invocation across a process boundary. That makes the tool server easier to reuse by compatible clients and creates a distinct place to govern capability access. It also adds server lifecycle, transport, and protocol complexity. In this local demonstration, MCP uses stdio; it is not a remote service.

## How is RAG being used?

The policy loader reads only approved Markdown files, chunks mainly by heading, and preserves document and section metadata. OpenAI embeddings represent each chunk and a search query as vectors. The local JSON index holds chunk text, metadata, and embeddings; cosine similarity ranks candidate passages. The search tool returns selected passages, not the whole library. Company policy thresholds are retrieved from those documents rather than placed in the system prompt.

## How do you prevent hallucinations?

The design reduces unsupported claims rather than promising that hallucinations are impossible. Calculations are performed by deterministic tools, SQL is parameterized and read-only, tool arguments are validated, and agent calls are capped. The agent is instructed to distinguish observed facts, inference, and policy, and to qualify causal conclusions when the data does not prove them. The UI exposes sources and tool activity, not private chain-of-thought. Model output still needs evaluation; the guardrails do not guarantee correctness.

## Why SQLite?

SQLite makes the synthetic data self-contained and repeatable, keeps setup local, and lets the deterministic tools demonstrate real relational queries without a database service. Its read-only query path is suitable for the scope of this demo. A production deployment with concurrent workloads, enterprise access controls, or larger data volumes would likely use the organization’s governed warehouse or operational data services.

## What would you change for production?

I would first add enterprise identity and authorization at the API and tool boundary, then replace or connect the synthetic source to governed ERP/WMS or warehouse data. I would evaluate whether remote MCP is needed and secure it with authenticated transport. I would add durable observability, privacy-aware audit retention, regression and adversarial evaluations, explicit data freshness handling, and operational monitoring. Policy sources would need ownership, versioning, and access rules. These are future enhancements, not present features of this repository.

## What did you personally learn by building this?

The project demonstrates the importance of separating deterministic business calculations from model synthesis, treating context selection as an architectural concern, and preserving provenance across structured metrics and retrieved text. It also makes the tradeoff between direct tools and a standardized MCP boundary concrete: protocol portability can improve reuse, but it introduces lifecycle and operational complexity. Finally, evidence boundaries matter—the available relationships can support a strong interpretation without establishing every causal link.
