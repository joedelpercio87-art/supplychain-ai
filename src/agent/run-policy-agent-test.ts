import { APIConnectionError, APIError } from 'openai';
import { runSupplyChainAgent, SUPPLY_CHAIN_MODEL } from './supplyChainAgent.ts';

const question = 'Investigate why OTIF performance declined in August 2026 and tell me what actions management should take according to company policy.';

try {
  const result = await runSupplyChainAgent(question);
  console.log(JSON.stringify({
    event: 'policy_agent_answer',
    model: SUPPLY_CHAIN_MODEL,
    toolCallRounds: result.toolCallRounds,
    toolCalls: result.toolCalls,
    answer: result.answer,
  }, null, 2));
} catch (error: unknown) {
  if (error instanceof APIConnectionError) {
    console.error('Policy agent test failed: APIConnectionError. Likely cause: network, DNS, TLS, or proxy connectivity.');
  } else if (error instanceof APIError) {
    const status = error.status;
    const category = status === 401 ? 'AuthenticationError'
      : status === 403 ? 'PermissionDeniedError'
        : status === 429 ? 'RateLimitError'
          : status === 404 ? 'NotFoundError'
            : status !== undefined && status >= 500 ? 'ServerError' : 'APIError';
    console.error(`Policy agent test failed: ${category} (HTTP ${status ?? 'unknown'}).`);
  } else {
    console.error('Policy agent test failed: unexpected runtime error; details omitted to protect credentials.');
  }
  process.exitCode = 1;
}
