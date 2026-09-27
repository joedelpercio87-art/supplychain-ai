# SupplyChain AI Architecture

The diagram shows the local application boundary, the external OpenAI model services, and the two governed data paths. Agent orchestration and MCP tool access run locally. Model inference and embedding generation use the OpenAI API. The MCP server is private to the local process and communicates with its clients over stdio.

## System architecture

```mermaid
flowchart TB
    User[Executive User]

    subgraph Local[Local machine · loopback UI and stdio MCP boundary]
        UI[React / Vite Executive UI]
        API[Local Express API]
        Agent[Agent orchestration<br/>context selection and tool loop]
        Client[MCP Client<br/>runtime tool discovery]

        subgraph Governed[Governed, read-only capability boundary]
            Server[SupplyChain MCP Server<br/>stdio]
            Tools[Operational Business Tools<br/>validated inputs · fixed queries]
            Policy[Policy Search Tool<br/>approved local index only]
        end

        DB[(SQLite Synthetic<br/>Operational Data)]
        Index[(Local Vector Index<br/>vectors + chunk metadata)]
        Docs[Approved Markdown<br/>Policy Documents]
    end

    subgraph OpenAI[OpenAI API]
        Responses[Responses API<br/>model reasoning and synthesis]
        Embeddings[Embeddings API<br/>text-embedding-3-small]
    end

    Grounded[Grounded Analysis<br/>facts · interpretation · policy · gaps]

    User -->|question| UI
    UI -->|local HTTP request| API
    API --> Agent
    Agent <-->|question, tool definitions,<br/>requested evidence only| Responses
    Agent --> Client
    Client <-->|discover and call tools| Server
    Server --> Tools
    Server --> Policy
    Tools <-->|parameterized read-only SQL| DB
    Policy -->|cosine similarity search| Index
    Docs -.->|section-aware chunking<br/>and indexing| Embeddings
    Embeddings -.->|vectors stored locally| Index
    Policy <-->|query embedding| Embeddings

    Tools -->|operational result| Server
    Policy -->|retrieved passages + source metadata| Server
    Server --> Client
    Client -->|selected tool results| Agent
    Responses -->|synthesis based on selected context| Grounded
    Agent -->|sanitized tool trace and evidence| API
    Grounded -->|executive response| API
    API --> UI
    UI -->|executive response · evidence · investigation trace| User
```

The OpenAI API receives the question, instructions, discovered tool definitions, and only the tool results requested during the investigation. It does not receive the full SQLite database or policy library. API credentials remain server-side. SQLite, policy files, the generated index, and the MCP stdio process stay on the local machine.

The policy index is generated from the approved `documents/` directory. At query time, the search tool embeds the query, compares it with stored vectors by cosine similarity, and returns selected text and source metadata. Embedding vectors are not returned to the UI.

## Illustrative investigation sequence

This sequence illustrates one possible August OTIF investigation. It is not a fixed workflow: the model may request a different tool, request several tools in a round, or omit policy search depending on the question and evidence already returned.

```mermaid
sequenceDiagram
    actor User
    participant UI as React/Vite UI
    participant Agent as Local Agent
    participant MCP as MCP Client / Server
    participant OTIF as OTIF Tool
    participant WH as Warehouse Tool
    participant INV as Inventory Tool
    participant VEN as Vendor Tool
    participant POL as Policy Search
    participant Model as OpenAI Responses API

    User->>UI: Ask an operational question
    UI->>Agent: POST question to local API
    Agent->>MCP: Discover available tools
    MCP-->>Agent: Tool schemas and descriptions
    Agent->>Model: Question + instructions + discovered tools
    Model-->>Agent: Request OTIF evidence
    Agent->>MCP: Call get_otif_metrics
    MCP->>OTIF: Validated read-only request
    OTIF-->>MCP: Structured OTIF metrics
    MCP-->>Agent: Requested operational evidence
    Agent->>Model: Return OTIF result
    Model-->>Agent: Request warehouse comparison
    Agent->>MCP: Call get_warehouse_performance
    MCP->>WH: Validated read-only request
    WH-->>MCP: Warehouse-level results
    MCP-->>Agent: Requested operational evidence
    Agent->>Model: Return warehouse result
    Model-->>Agent: Request inventory evidence
    Agent->>MCP: Call get_inventory_health
    MCP->>INV: Validated read-only request
    INV-->>MCP: Below-safety-stock details
    MCP-->>Agent: Requested operational evidence
    Agent->>Model: Return inventory result
    Model-->>Agent: Request vendor evidence
    Agent->>MCP: Call get_vendor_performance
    MCP->>VEN: Validated read-only request
    VEN-->>MCP: PO timing and receiving warehouse details
    MCP-->>Agent: Requested operational evidence
    Agent->>Model: Return vendor result
    Model-->>Agent: Request policy evidence when useful
    Agent->>MCP: Call search_company_policies
    MCP->>POL: Search approved local vector index
    POL-->>MCP: Ranked passages and source metadata
    MCP-->>Agent: Requested policy passages
    Agent->>Model: Return selected evidence
    Model-->>Agent: Grounded answer
    Agent-->>UI: Answer + sanitized tool trace and evidence
    UI-->>User: Executive response and investigation context
```

The MCP layer is an adapter around existing TypeScript capabilities. SQL and retrieval logic remain in their existing application layers rather than being reimplemented in the protocol server.
