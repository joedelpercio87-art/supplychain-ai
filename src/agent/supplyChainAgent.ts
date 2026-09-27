import OpenAI from 'openai';
import type { FunctionTool, ResponseFunctionToolCall, ResponseInputItem } from 'openai/resources/responses/responses';
import {
  getCustomerImpact,
  getInventoryHealth,
  getOtifMetrics,
  getVendorPerformance,
  getWarehousePerformance,
} from '../tools/index.ts';
import { searchCompanyPolicies, summarizeEmbeddingError } from '../context/index.ts';
import type {
  GetCustomerImpactInput,
  GetInventoryHealthInput,
  GetOtifMetricsInput,
  GetVendorPerformanceInput,
  WarehousePerformanceInput,
} from '../tools/types.ts';

export const SUPPLY_CHAIN_MODEL = 'gpt-6-luna';
export const MAX_TOOL_CALL_ROUNDS = 6;
export const MAX_TOTAL_TOOL_CALLS = 18;

const SYSTEM_INSTRUCTIONS = `You are SupplyChain AI, an executive supply chain analyst. Answer the user's business question concisely using only the user's question and results returned by the available tools. Do not invent data or use outside knowledge.

Business-data tools provide observed operational facts. searchCompanyPolicies provides approved fictional company policies and procedures. Use policy search when the question requires company-defined procedures, escalation thresholds, service requirements, or recommended actions. Choose search queries based on the question; do not assume any specific policy applies until a returned passage supports it. Only retrieved policy text is evidence of policy. For investigations that request actions, structure the final answer with four clearly labeled parts: Observed operational facts; Evidence-based interpretation; Policy requirements; Recommended actions. Recommendations attributed to company policy must be supported by retrieved policy text; otherwise identify them as analysis or state that policy evidence is unavailable. Do not add recommendations from general model knowledge.

For cause investigations, connecting multiple measures is an inference. Use cautious language such as "the evidence indicates", "the data suggests", or "is associated with" unless results directly prove causation. Do not overstate causation. If evidence is incomplete, say what is unknown. Never claim to have used a tool unless it returned a result.

Tool date ranges are inclusive. Customer order tools filter by order date; inventory uses snapshot date; vendor performance uses expected delivery date. OTIF requires on-time shipping and delivery and complete shipment of all order lines. Do not request tools unrelated to the user's question.`;

const TOOLS: FunctionTool[] = [
  {
    type: 'function', name: 'getOtifMetrics', strict: true,
    description: 'Get aggregate order-level OTIF metrics for an inclusive date range, with optional warehouse/customer filters. Customer orders are filtered by order_date.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        startDate: { type: 'string', description: 'Inclusive start date in YYYY-MM-DD format.' },
        endDate: { type: 'string', description: 'Inclusive end date in YYYY-MM-DD format.' },
        warehouseId: { type: ['integer', 'null'], description: 'Optional warehouse ID, or null for all warehouses.' },
        customerId: { type: ['integer', 'null'], description: 'Optional customer ID, or null for all customers.' },
      }, required: ['startDate', 'endDate', 'warehouseId', 'customerId'],
    },
  },
  {
    type: 'function', name: 'getWarehousePerformance', strict: true,
    description: 'Compare order totals, OTIF rate, late orders, and partial shipments by warehouse. Customer orders are filtered by order_date.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        startDate: { type: 'string', description: 'Inclusive start date in YYYY-MM-DD format.' },
        endDate: { type: 'string', description: 'Inclusive end date in YYYY-MM-DD format.' },
      }, required: ['startDate', 'endDate'],
    },
  },
  {
    type: 'function', name: 'getInventoryHealth', strict: true,
    description: 'Find product/warehouse inventory snapshots below product safety stock and summarize duration and lowest quantity. Dates refer to inventory snapshot dates.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        startDate: { type: 'string', description: 'Inclusive start date in YYYY-MM-DD format.' },
        endDate: { type: 'string', description: 'Inclusive end date in YYYY-MM-DD format.' },
        warehouseId: { type: ['integer', 'null'], description: 'Optional warehouse ID, or null for all warehouses.' },
        productId: { type: ['integer', 'null'], description: 'Optional product ID, or null for all products.' },
      }, required: ['startDate', 'endDate', 'warehouseId', 'productId'],
    },
  },
  {
    type: 'function', name: 'getVendorPerformance', strict: true,
    description: 'Measure purchase order on-time and late delivery performance. For each late PO, return the receiving warehouse, product, delivery dates, days late, and quantities. Date range refers to expected delivery dates.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        startDate: { type: 'string', description: 'Inclusive start date in YYYY-MM-DD format.' },
        endDate: { type: 'string', description: 'Inclusive end date in YYYY-MM-DD format.' },
        vendorId: { type: ['integer', 'null'], description: 'Optional vendor ID, or null for all vendors.' },
      }, required: ['startDate', 'endDate', 'vendorId'],
    },
  },
  {
    type: 'function', name: 'getCustomerImpact', strict: true,
    description: 'Summarize customer order OTIF, late/partial orders, and estimated revenue on affected orders. Customer orders are filtered by order_date.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        startDate: { type: 'string', description: 'Inclusive start date in YYYY-MM-DD format.' },
        endDate: { type: 'string', description: 'Inclusive end date in YYYY-MM-DD format.' },
        warehouseId: { type: ['integer', 'null'], description: 'Optional warehouse ID, or null for all warehouses.' },
      }, required: ['startDate', 'endDate', 'warehouseId'],
    },
  },
  {
    type: 'function', name: 'searchCompanyPolicies', strict: true,
    description: 'Search the approved local index for company procedures, escalation requirements, service standards, or policy-backed actions. Returns relevant passages with document, section, chunk ID, text, and similarity.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Natural-language semantic search query.' },
        topK: { type: ['integer', 'null'], description: 'Optional result count from 1 to 10; null uses the default.' },
      }, required: ['query', 'topK'],
    },
  },
];

type JsonObject = Record<string, unknown>;
type ExecutedTool = { name: string; arguments: JsonObject; result: unknown };
export interface AgentRunResult {
  answer: string;
  toolCallRounds: number;
  toolCalls: Array<{ name: string; arguments: JsonObject; summary: string }>;
}

function requiredDate(args: JsonObject, name: 'startDate' | 'endDate'): string {
  const value = args[name];
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`);
  return value;
}

function optionalId(args: JsonObject, name: string): number | undefined {
  const value = args[name];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer or null`);
  }
  return value;
}

function parseArguments(call: ResponseFunctionToolCall): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(call.arguments);
  } catch {
    throw new TypeError('Tool arguments must be valid JSON');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Tool arguments must be a JSON object');
  }
  const args = value as JsonObject;
  const expectedKeys: Record<string, string[]> = {
    getOtifMetrics: ['startDate', 'endDate', 'warehouseId', 'customerId'],
    getWarehousePerformance: ['startDate', 'endDate'],
    getInventoryHealth: ['startDate', 'endDate', 'warehouseId', 'productId'],
    getVendorPerformance: ['startDate', 'endDate', 'vendorId'],
    getCustomerImpact: ['startDate', 'endDate', 'warehouseId'],
    searchCompanyPolicies: ['query', 'topK'],
  };
  const allowed = expectedKeys[call.name];
  if (!allowed) throw new TypeError('Unknown business tool');
  if (Object.keys(args).some((key) => !allowed.includes(key))) {
    throw new TypeError('Unexpected tool argument');
  }
  for (const required of allowed) {
    if (!(required in args)) throw new TypeError(`Missing required argument: ${required}`);
  }
  if (call.name === 'searchCompanyPolicies') {
    if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 4000) {
      throw new TypeError('query must be a non-empty string of at most 4000 characters');
    }
    if (args.topK !== null && (typeof args.topK !== 'number' || !Number.isSafeInteger(args.topK) || args.topK < 1 || args.topK > 10)) {
      throw new TypeError('topK must be an integer from 1 to 10 or null');
    }
  }
  // Existing public tool functions validate ISO calendar dates and all supplied IDs.
  return args;
}

function sanitizeArgs(args: JsonObject): JsonObject {
  const safe: JsonObject = {};
  for (const key of ['startDate', 'endDate', 'warehouseId', 'customerId', 'productId', 'vendorId', 'query', 'topK']) {
    const value = args[key];
    if (typeof value === 'string' && value.length <= (key === 'query' ? 4000 : 10)) safe[key] = value;
    else if (typeof value === 'number' && Number.isSafeInteger(value)) safe[key] = value;
    else if (value === null) safe[key] = null;
  }
  return safe;
}

function callBusinessTool(name: string, args: JsonObject): unknown {
  if (name === 'searchCompanyPolicies') throw new TypeError('Policy search requires asynchronous execution');
  const startDate = requiredDate(args, 'startDate');
  const endDate = requiredDate(args, 'endDate');
  switch (name) {
    case 'getOtifMetrics':
      return getOtifMetrics({ startDate, endDate,
        warehouseId: optionalId(args, 'warehouseId'), customerId: optionalId(args, 'customerId') } satisfies GetOtifMetricsInput);
    case 'getWarehousePerformance':
      return getWarehousePerformance({ startDate, endDate } satisfies WarehousePerformanceInput);
    case 'getInventoryHealth':
      return getInventoryHealth({ startDate, endDate,
        warehouseId: optionalId(args, 'warehouseId'), productId: optionalId(args, 'productId') } satisfies GetInventoryHealthInput);
    case 'getVendorPerformance':
      return getVendorPerformance({ startDate, endDate, vendorId: optionalId(args, 'vendorId') } satisfies GetVendorPerformanceInput);
    case 'getCustomerImpact':
      return getCustomerImpact({ startDate, endDate,
        warehouseId: optionalId(args, 'warehouseId') } satisfies GetCustomerImpactInput);
    default:
      throw new TypeError('Unknown business tool');
  }
}

function summarizeResult(name: string, result: unknown): string {
  if (result !== null && typeof result === 'object' && 'error' in result) {
    return String((result as { error: unknown }).error);
  }
  if (result !== null && typeof result === 'object' && 'contextType' in result) {
    const wrapped = result as { contextType: string; result?: unknown; results?: unknown };
    if (wrapped.contextType === 'operational_facts') result = wrapped.result;
    else if (wrapped.contextType === 'approved_policy_passages') result = { results: wrapped.results };
  }
  if (name === 'getOtifMetrics') {
    const data = result as { totalOrders: number; otifPercentage: number; otifOrders: number };
    return `${data.totalOrders} orders; ${data.otifOrders} OTIF (${data.otifPercentage}%).`;
  }
  if (name === 'getWarehousePerformance') {
    const rows = result as Array<{ warehouseName: string; otifPercentage: number; totalOrders: number }>;
    const lowest = [...rows].sort((a, b) => a.otifPercentage - b.otifPercentage)[0];
    return `${rows.length} warehouses; lowest OTIF is ${lowest?.warehouseName ?? 'n/a'} (${lowest?.otifPercentage ?? 0}%).`;
  }
  if (name === 'getInventoryHealth') {
    const data = result as { productsBelowSafetyStock: number; numberOfDaysBelowSafetyStock: number };
    return `${data.productsBelowSafetyStock} products below safety stock across ${data.numberOfDaysBelowSafetyStock} product-location-days.`;
  }
  if (name === 'getVendorPerformance') {
    const data = result as { vendors: Array<{ vendorName: string; purchaseOrders: number; lateDeliveries: number;
      latePurchaseOrders?: Array<{ warehouseName: string }> }> };
    const latest = [...data.vendors].sort((a, b) => b.lateDeliveries - a.lateDeliveries)[0];
    const destinations = [...new Set(latest?.latePurchaseOrders?.map((po) => po.warehouseName) ?? [])];
    return `${data.vendors.length} vendors; highest late count is ${latest?.vendorName ?? 'n/a'} (${latest?.lateDeliveries ?? 0}/${latest?.purchaseOrders ?? 0}); late PO destinations: ${destinations.join(', ') || 'none'}.`;
  }
  if (name === 'searchCompanyPolicies') {
    const data = result as { results: Array<{ document: string; section: string }> };
    const sections = data.results.map((row) => `${row.document} — ${row.section}`);
    return `${sections.length} policy passages returned: ${sections.join('; ') || 'none'}.`;
  }
  const data = result as { customers: Array<{ estimatedAffectedRevenue: number }> };
  return `${data.customers.length} customers; ${data.customers.filter((customer) => customer.estimatedAffectedRevenue > 0).length} with affected revenue.`;
}

async function executeTool(call: ResponseFunctionToolCall): Promise<ExecutedTool> {
  let parsed: JsonObject | undefined;
  try {
    parsed = parseArguments(call);
    const safeArguments = sanitizeArgs(parsed);
    const result = call.name === 'searchCompanyPolicies'
      ? {
        contextType: 'approved_policy_passages',
        results: (await searchCompanyPolicies(parsed.query as string, {
          topK: parsed.topK === null ? undefined : parsed.topK as number,
        })).map(({ document, section, chunkId, text, similarity }) => ({ document, section, chunkId, text, similarity })),
      }
      : { contextType: 'operational_facts', result: callBusinessTool(call.name, parsed) };
    const summary = summarizeResult(call.name, result);
    console.log(JSON.stringify({ event: 'tool_result', name: call.name, arguments: safeArguments, summary }));
    return { name: call.name, arguments: safeArguments, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid arguments';
    const safeArguments = parsed ? sanitizeArgs(parsed) : { invalid: true };
    const isPolicySearch = call.name === 'searchCompanyPolicies';
    const safeMessage = isPolicySearch
      ? (message.startsWith('query must') || message.startsWith('topK must') || message.startsWith('Unexpected') || message.startsWith('Missing')
        ? message : summarizeEmbeddingError(error))
      : message;
    const result = { error: isPolicySearch ? 'Policy search failed' : 'Tool arguments rejected', message: safeMessage };
    console.log(JSON.stringify({ event: 'tool_result', name: call.name, arguments: safeArguments, summary: safeMessage }));
    return { name: call.name, arguments: safeArguments, result };
  }
}

export async function runSupplyChainAgent(question: string): Promise<AgentRunResult> {
  const normalizedQuestion = question.trim();
  if (!normalizedQuestion) throw new TypeError('A non-empty question is required');
  if (normalizedQuestion.length > 4_000) throw new TypeError('Question exceeds the 4000-character limit');
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || ['your_key_goes_here', 'your_openai_api_key_here'].includes(apiKey.toLowerCase())) {
    throw new Error('OPENAI_API_KEY is missing or still a placeholder');
  }

  const client = new OpenAI({ apiKey });
  const toolCalls: AgentRunResult['toolCalls'] = [];
  let toolCallRounds = 0;
  let totalToolCalls = 0;

  console.log(JSON.stringify({ event: 'agent_question', question: normalizedQuestion }));
  let response = await client.responses.create({
    model: SUPPLY_CHAIN_MODEL,
    reasoning: { effort: 'medium' },
    instructions: SYSTEM_INSTRUCTIONS,
    input: normalizedQuestion,
    tools: TOOLS,
    tool_choice: 'auto',
  });

  while (true) {
    const calls = response.output.filter((item): item is ResponseFunctionToolCall => item.type === 'function_call');
    if (calls.length === 0) {
      const answer = response.output_text.trim();
      console.log(JSON.stringify({ event: 'agent_complete', toolCallRounds }));
      return { answer: answer || 'I could not form a supported answer from the available tool results.', toolCallRounds, toolCalls };
    }

    if (toolCallRounds >= MAX_TOOL_CALL_ROUNDS) {
      const outputs: ResponseInputItem[] = calls.map((call) => ({
        type: 'function_call_output', call_id: call.call_id,
        output: JSON.stringify({ error: 'Tool-call round limit reached; no further data was queried.' }),
      }));
      console.log(JSON.stringify({ event: 'tool_call_limit', maxRounds: MAX_TOOL_CALL_ROUNDS, toolCallRounds }));
      response = await client.responses.create({
        model: SUPPLY_CHAIN_MODEL, reasoning: { effort: 'medium' }, instructions: SYSTEM_INSTRUCTIONS,
        previous_response_id: response.id, input: outputs, tools: TOOLS, tool_choice: 'none',
      });
      continue;
    }

    toolCallRounds++;
    console.log(JSON.stringify({ event: 'tool_call_round', round: toolCallRounds, requested: calls.map((call) => call.name) }));
    const outputs: ResponseInputItem[] = [];
    for (const call of calls) {
      totalToolCalls++;
      let execution: ExecutedTool;
      if (totalToolCalls > MAX_TOTAL_TOOL_CALLS) {
        execution = { name: call.name, arguments: { limitReached: true },
          result: { error: 'Total tool-call limit reached; no further data was queried.' } };
        console.log(JSON.stringify({ event: 'tool_result', name: call.name, arguments: { limitReached: true },
          summary: 'Total tool-call limit reached.' }));
      } else {
        execution = await executeTool(call);
      }
      toolCalls.push({ name: execution.name, arguments: execution.arguments, summary: summarizeResult(execution.name, execution.result) });
      outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(execution.result) });
    }
    response = await client.responses.create({
      model: SUPPLY_CHAIN_MODEL,
      reasoning: { effort: 'medium' },
      instructions: SYSTEM_INSTRUCTIONS,
      previous_response_id: response.id,
      input: outputs,
      tools: TOOLS,
      tool_choice: 'auto',
    });
  }
}
