import { APIConnectionError, APIError } from 'openai';
import { runMcpSupplyChainAgent, MCP_SUPPLY_CHAIN_MODEL } from './mcpSupplyChainAgent.ts';

const question = 'Investigate why OTIF performance declined in August 2026 and tell me what actions management should take according to company policy.';

try {
  const mcpResult = await runMcpSupplyChainAgent(question);
  console.log(JSON.stringify({
    event: 'mcp_agent_answer',
    model: MCP_SUPPLY_CHAIN_MODEL,
    toolCallRounds: mcpResult.toolCallRounds,
    discoveredTools: mcpResult.discoveredTools,
    toolCalls: mcpResult.toolCalls,
    answer: mcpResult.answer,
  }, null, 2));
} catch (error: unknown) {
  if (error instanceof APIConnectionError) {
    console.error('MCP agent test failed: APIConnectionError. Likely cause: network, DNS, TLS, or proxy connectivity.');
  } else if (error instanceof APIError) {
    const status = error.status;
    const category = status === 401 ? 'AuthenticationError'
      : status === 403 ? 'PermissionDeniedError'
        : status === 429 ? 'RateLimitError'
          : status === 404 ? 'NotFoundError'
            : status !== undefined && status >= 500 ? 'ServerError' : 'APIError';
    console.error(`MCP agent test failed: ${category} (HTTP ${status ?? 'unknown'}).`);
  } else {
    console.error('MCP agent test failed: unexpected runtime error; details omitted to protect credentials.');
  }
  process.exitCode = 1;
}
