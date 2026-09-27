import OpenAI from 'openai';
import type { FunctionTool, ResponseFunctionToolCall, ResponseInputItem } from 'openai/resources/responses/responses';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

export const MCP_SUPPLY_CHAIN_MODEL = 'gpt-6-luna';
export const MCP_MAX_TOOL_CALL_ROUNDS = 6;
export const MCP_MAX_TOTAL_TOOL_CALLS = 18;

const SYSTEM_INSTRUCTIONS = `You are SupplyChain AI, an executive supply chain analyst. Use only the user's question and results returned by discovered MCP tools. Do not invent data or use outside knowledge.

Business-data tools provide observed operational facts. The company-policy search capability returns approved fictional policy passages. Use it when the question requires company-defined procedures, escalation thresholds, service requirements, or policy-backed actions. Do not assume policy rules until a returned passage supports them. Only retrieved policy text is evidence of policy. Keep operational facts and policy passages distinguishable. For investigations requesting actions, clearly label observed operational facts, evidence-based interpretation, policy requirements, and recommended actions. Recommendations attributed to policy must be grounded in returned policy passages; do not substitute general model knowledge.

Connecting multiple operational measures is an inference. Use cautious language such as "the evidence indicates", "the data suggests", or "is associated with" unless returned data directly proves causation. Do not overstate causation. If evidence is incomplete, say what is unknown. Select only MCP tools that help answer the question.`;

type JsonObject = Record<string, unknown>;
type DiscoveredTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};
type ExecutedTool = { name: string; arguments: JsonObject; result: unknown; summary: string };

export interface McpAgentRunResult {
  answer: string;
  toolCallRounds: number;
  discoveredTools: string[];
  toolCalls: Array<{ name: string; arguments: JsonObject; summary: string }>;
}

export interface McpAgentRunOptions {
  onToolResult?: (observation: { name: string; arguments: JsonObject; result: unknown; summary: string }) => void;
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseObject(raw: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TypeError('Tool arguments must be valid JSON');
  }
  if (!isRecord(parsed)) throw new TypeError('Tool arguments must be a JSON object');
  return parsed;
}

function validateDiscoveredSchema(args: JsonObject, inputSchema: unknown): void {
  if (!isRecord(inputSchema) || inputSchema.type !== 'object' || !isRecord(inputSchema.properties)) {
    throw new TypeError('Discovered tool has an unsupported input schema');
  }
  const properties = inputSchema.properties;
  const required = Array.isArray(inputSchema.required) ? inputSchema.required : [];
  const extraKeys = Object.keys(args).filter((key) => !(key in properties));
  if (extraKeys.length && inputSchema.additionalProperties === false) {
    throw new TypeError('Unexpected tool argument');
  }
  for (const key of required) {
    if (typeof key === 'string' && !(key in args)) throw new TypeError(`Missing required argument: ${key}`);
  }
  for (const [key, value] of Object.entries(args)) {
    const property = properties[key];
    if (!isRecord(property)) continue;
    const types = Array.isArray(property.type) ? property.type : [property.type];
    const typeOk = types.some((type) => {
      if (type === 'string') return typeof value === 'string';
      if (type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value);
      if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
      if (type === 'boolean') return typeof value === 'boolean';
      if (type === 'null') return value === null;
      if (type === 'array') return Array.isArray(value);
      if (type === 'object') return isRecord(value);
      return false;
    });
    if (!typeOk) throw new TypeError(`Invalid value type for ${key}`);
    if (typeof value === 'string') {
      if (typeof property.minLength === 'number' && value.length < property.minLength) throw new TypeError(`Invalid value for ${key}`);
      if (typeof property.maxLength === 'number' && value.length > property.maxLength) throw new TypeError(`Invalid value for ${key}`);
      if (typeof property.pattern === 'string' && !(new RegExp(property.pattern)).test(value)) throw new TypeError(`Invalid value for ${key}`);
    }
    if (typeof value === 'number') {
      if (typeof property.minimum === 'number' && value < property.minimum) throw new TypeError(`Invalid value for ${key}`);
      if (typeof property.maximum === 'number' && value > property.maximum) throw new TypeError(`Invalid value for ${key}`);
    }
  }
}

function scrub(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[credential-redacted]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [credential-redacted]')
    .replace(/OPENAI_API_KEY\s*[=:]\s*\S+/gi, 'OPENAI_API_KEY=[credential-redacted]');
}

function sanitizedArguments(args: JsonObject): JsonObject {
  const sanitized: JsonObject = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') sanitized[key] = scrub(value).slice(0, key.toLowerCase().includes('query') ? 400 : 80);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) sanitized[key] = value;
    else if (Array.isArray(value)) sanitized[key] = `[${value.length} items]`;
    else if (isRecord(value)) sanitized[key] = '[object]';
  }
  return sanitized;
}

function toOpenAITool(tool: DiscoveredTool): FunctionTool {
  if (!tool.name || !isRecord(tool.inputSchema)) throw new TypeError('MCP server advertised a tool without a usable input schema');
  return {
    type: 'function',
    name: tool.name,
    description: tool.description ?? `Call the ${tool.name} capability through the local SupplyChain MCP server.`,
    parameters: tool.inputSchema as FunctionTool['parameters'],
    strict: false,
  };
}

function summarizeToolResult(name: string, value: unknown): string {
  const data = isRecord(value) && 'result' in value ? value.result : value;
  if (name.toLowerCase().includes('polic')) {
    const passages = Array.isArray(data) ? data.filter(isRecord) : [];
    const refs = passages.map((item) => `${String(item.document ?? 'unknown')} — ${String(item.section ?? 'unknown')}`);
    return `${passages.length} policy passages; ${refs.join('; ') || 'none returned'}.`;
  }
  if (name.toLowerCase().includes('warehouse') && Array.isArray(data)) {
    const rows = data.filter(isRecord);
    const lowest = [...rows].sort((left, right) => Number(left.otifPercentage ?? 100) - Number(right.otifPercentage ?? 100))[0];
    return `${rows.length} warehouses; lowest OTIF is ${String(lowest?.warehouseName ?? 'n/a')} (${String(lowest?.otifPercentage ?? 'n/a')}%).`;
  }
  if (name.toLowerCase().includes('vendor') && isRecord(data) && Array.isArray(data.vendors)) {
    const rows = data.vendors.filter(isRecord);
    const latest = [...rows].sort((left, right) => Number(right.lateDeliveries ?? 0) - Number(left.lateDeliveries ?? 0))[0];
    const details = isRecord(latest) && Array.isArray(latest.latePurchaseOrders) ? latest.latePurchaseOrders.filter(isRecord) : [];
    const destinations = [...new Set(details.map((row) => String(row.warehouseName ?? 'unknown')))];
    return `${rows.length} vendors; highest late count is ${String(latest?.vendorName ?? 'n/a')} (${String(latest?.lateDeliveries ?? 0)}); destinations: ${destinations.join(', ') || 'not specified'}.`;
  }
  if (name.toLowerCase().includes('customer') && isRecord(data) && Array.isArray(data.customers)) {
    return `${data.customers.length} customer summaries returned.`;
  }
  if (isRecord(data)) {
    if (typeof data.totalOrders === 'number' && typeof data.otifPercentage === 'number') {
      return `${data.totalOrders} orders; ${String(data.otifOrders ?? 0)} OTIF (${data.otifPercentage}%).`;
    }
    if (typeof data.productsBelowSafetyStock === 'number') {
      return `${data.productsBelowSafetyStock} products below safety stock across ${String(data.numberOfDaysBelowSafetyStock ?? 0)} product-location-days.`;
    }
    if (Array.isArray(data.vendors)) return `${data.vendors.length} vendor summaries returned.`;
    if (Array.isArray(data.customers)) return `${data.customers.length} customer summaries returned.`;
    return `Structured result with fields: ${Object.keys(data).slice(0, 8).join(', ')}.`;
  }
  if (Array.isArray(data)) return `${data.length} records returned.`;
  return 'Tool returned a structured result.';
}

function resultContextType(toolName: string): 'approved_policy_passages' | 'operational_facts' {
  return toolName.toLowerCase().includes('polic') ? 'approved_policy_passages' : 'operational_facts';
}

export async function runMcpSupplyChainAgent(question: string, options: McpAgentRunOptions = {}): Promise<McpAgentRunResult> {
  const normalizedQuestion = question.trim();
  if (!normalizedQuestion) throw new TypeError('A non-empty question is required');
  if (normalizedQuestion.length > 4000) throw new TypeError('Question exceeds the 4000-character limit');
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || ['your_key_goes_here', 'your_openai_api_key_here'].includes(apiKey.toLowerCase())) {
    throw new Error('OPENAI_API_KEY is missing or still a placeholder');
  }

  const client = new OpenAI({ apiKey });
  const mcpClient = new Client({ name: 'supplychain-ai-mcp-agent', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--env-file-if-exists=.env', '--disable-warning=ExperimentalWarning', '--experimental-strip-types', 'src/mcp/server.ts'],
    cwd: process.cwd(),
    stderr: 'inherit',
  });
  const toolCalls: McpAgentRunResult['toolCalls'] = [];
  let toolCallRounds = 0;
  let totalToolCalls = 0;

  try {
    await mcpClient.connect(transport);
    const discovery = await mcpClient.listTools();
    const discoveredTools = discovery.tools as DiscoveredTool[];
    if (!discoveredTools.length) throw new Error('MCP server advertised no tools');
    const toolsByName = new Map(discoveredTools.map((tool) => [tool.name, tool]));
    const functionTools = discoveredTools.map(toOpenAITool);

    console.log(JSON.stringify({ event: 'mcp_tools_discovered', tools: discoveredTools.map((tool) => tool.name) }));
    console.log(JSON.stringify({ event: 'mcp_agent_question', question: scrub(normalizedQuestion) }));

    let response = await client.responses.create({
      model: MCP_SUPPLY_CHAIN_MODEL,
      reasoning: { effort: 'medium' },
      instructions: SYSTEM_INSTRUCTIONS,
      input: normalizedQuestion,
      tools: functionTools,
      tool_choice: 'auto',
    });

    while (true) {
      const calls = response.output.filter((item): item is ResponseFunctionToolCall => item.type === 'function_call');
      if (!calls.length) {
        console.log(JSON.stringify({ event: 'mcp_agent_complete', toolCallRounds }));
        return {
          answer: response.output_text.trim() || 'I could not form a supported answer from the available MCP tool results.',
          toolCallRounds,
          discoveredTools: discoveredTools.map((tool) => tool.name),
          toolCalls,
        };
      }

      if (toolCallRounds >= MCP_MAX_TOOL_CALL_ROUNDS) {
        const limitOutputs: ResponseInputItem[] = calls.map((call) => ({
          type: 'function_call_output', call_id: call.call_id,
          output: JSON.stringify({ error: 'Tool-call round limit reached; no further data was queried.' }),
        }));
        console.log(JSON.stringify({ event: 'mcp_tool_call_limit', maxRounds: MCP_MAX_TOOL_CALL_ROUNDS, toolCallRounds }));
        response = await client.responses.create({
          model: MCP_SUPPLY_CHAIN_MODEL,
          reasoning: { effort: 'medium' },
          instructions: SYSTEM_INSTRUCTIONS,
          previous_response_id: response.id,
          input: limitOutputs,
          tools: functionTools,
          tool_choice: 'none',
        });
        continue;
      }

      toolCallRounds += 1;
      console.log(JSON.stringify({ event: 'mcp_tool_call_round', round: toolCallRounds, requested: calls.map((call) => call.name) }));
      const outputs: ResponseInputItem[] = [];
      for (const call of calls) {
        totalToolCalls += 1;
        const parsed = parseObject(call.arguments);
        const safeArgs = sanitizedArguments(parsed);
        let toolOutput: unknown;
        let summary: string;
        if (totalToolCalls > MCP_MAX_TOTAL_TOOL_CALLS) {
          toolOutput = { error: 'Total tool-call limit reached; no further data was queried.' };
          summary = 'Total tool-call limit reached.';
        } else {
          const discovered = toolsByName.get(call.name);
          if (!discovered) {
            toolOutput = { error: 'Requested tool was not discovered from the MCP server.' };
            summary = 'Rejected unknown MCP tool.';
          } else {
            try {
              validateDiscoveredSchema(parsed, discovered.inputSchema);
              const result = await mcpClient.callTool({ name: call.name, arguments: parsed });
              if (result.isError) {
                toolOutput = { error: 'MCP tool call failed' };
                summary = 'MCP server returned a tool error.';
              } else {
                const structured = isRecord(result.structuredContent) ? result.structuredContent : {};
                const data = structured.result ?? result.content
                  .filter((item) => item.type === 'text')
                  .map((item) => item.text)
                  .join('\n');
                toolOutput = {
                  contextType: resultContextType(call.name),
                  source: call.name,
                  result: data,
                };
                summary = summarizeToolResult(call.name, data);
              }
            } catch (error) {
              toolOutput = { error: 'MCP arguments rejected or tool unavailable' };
              summary = error instanceof TypeError ? scrub(error.message) : 'MCP tool execution failed.';
            }
          }
        }
        console.log(JSON.stringify({ event: 'mcp_tool_result', name: call.name, arguments: safeArgs, summary }));
        toolCalls.push({ name: call.name, arguments: safeArgs, summary });
        options.onToolResult?.({ name: call.name, arguments: safeArgs, result: toolOutput, summary });
        outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(toolOutput) });
      }
      response = await client.responses.create({
        model: MCP_SUPPLY_CHAIN_MODEL,
        reasoning: { effort: 'medium' },
        instructions: SYSTEM_INSTRUCTIONS,
        previous_response_id: response.id,
        input: outputs,
        tools: functionTools,
        tool_choice: 'auto',
      });
    }
  } finally {
    await mcpClient.close();
  }
}
