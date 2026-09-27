import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--env-file-if-exists=.env', '--disable-warning=ExperimentalWarning', '--experimental-strip-types', 'src/mcp/server.ts'],
  cwd: process.cwd(),
  stderr: 'inherit',
});
const client = new Client({ name: 'supplychain-ai-mcp-validator', version: '1.0.0' });

function resultData(result: { structuredContent?: unknown; isError?: boolean }): Record<string, unknown> {
  assert.equal(result.isError, undefined, 'MCP tool should not return an error');
  assert.ok(result.structuredContent && typeof result.structuredContent === 'object', 'Expected structuredContent');
  return result.structuredContent as Record<string, unknown>;
}

try {
  await client.connect(transport);
  const discovered = await client.listTools();
  const names = discovered.tools.map((tool) => tool.name).sort();
  const expected = [
    'get_otif_metrics',
    'get_warehouse_performance',
    'get_inventory_health',
    'get_vendor_performance',
    'get_customer_impact',
    'search_company_policies',
  ].sort();
  assert.deepEqual(names, expected, 'Expected all six SupplyChain MCP tools');

  const otifCall = await client.callTool({
    name: 'get_otif_metrics',
    arguments: { startDate: '2026-08-01', endDate: '2026-08-31' },
  });
  const otif = resultData(otifCall);
  assert.ok(otif.result && typeof otif.result === 'object', 'OTIF result should be structured');

  const warehouseCall = await client.callTool({
    name: 'get_warehouse_performance',
    arguments: { startDate: '2026-08-01', endDate: '2026-08-31' },
  });
  const warehouseData = resultData(warehouseCall);
  assert.ok(Array.isArray(warehouseData.result), 'Warehouse performance should be an array');

  const policyCall = await client.callTool({
    name: 'search_company_policies',
    arguments: { query: 'What happens when a vendor is more than 10 days late?' },
  });
  const policyData = resultData(policyCall);
  assert.ok(Array.isArray(policyData.result), 'Policy search should return structured results');
  const policyResults = policyData.result as Array<Record<string, unknown>>;
  assert.ok(policyResults.length > 0, 'Policy search should return at least one passage');

  console.log(JSON.stringify({
    status: 'passed',
    discoveredTools: names,
    samples: {
      get_otif_metrics: otif.result,
      get_warehouse_performance: warehouseData.result,
      search_company_policies_top_result: policyResults[0],
    },
  }, null, 2));
} finally {
  await client.close();
}
