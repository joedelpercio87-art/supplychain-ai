import express, { type Request, type Response } from 'express';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { runMcpSupplyChainAgent, type McpAgentRunResult } from '../agent/mcpSupplyChainAgent.ts';

const API_HOST = '127.0.0.1';
const API_PORT = Number(process.env.UI_API_PORT ?? 5175);
const MCP_TOOLS = [
  'get_otif_metrics',
  'get_warehouse_performance',
  'get_inventory_health',
  'get_vendor_performance',
  'get_customer_impact',
  'search_company_policies',
] as const;

interface ToolObservation {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  summary: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resultPayload(result: unknown): unknown {
  if (!isRecord(result)) return undefined;
  const wrapped = result.result;
  return wrapped;
}

function displayToolName(name: string): string {
  const labels: Record<string, string> = {
    get_otif_metrics: 'OTIF Metrics',
    get_warehouse_performance: 'Warehouse Performance',
    get_inventory_health: 'Inventory Health',
    get_vendor_performance: 'Vendor Performance',
    get_customer_impact: 'Customer Impact',
    search_company_policies: 'Policy Search',
  };
  return labels[name] ?? name;
}

function buildInvestigationMetadata(observations: ToolObservation[], run: McpAgentRunResult) {
  const used = [...new Set(observations.map((item) => item.name))];
  const policies = observations
    .filter((item) => item.name === 'search_company_policies')
    .flatMap((item) => Array.isArray(resultPayload(item.result)) ? resultPayload(item.result) as unknown[] : [])
    .filter(isRecord);
  const policySources = [...new Map(policies.map((item) => {
    const document = String(item.document ?? '');
    const section = String(item.section ?? '');
    const preview = typeof item.text === 'string' ? item.text.replace(/\s+/g, ' ').trim().slice(0, 240) : '';
    return [`${document}::${section}`, {
      document,
      section,
      chunkId: String(item.chunkId ?? ''),
      ...(typeof item.similarity === 'number' ? { similarity: item.similarity } : {}),
      preview,
    }];
  })).values()];

  const otif = observations.flatMap((item) => {
    const result = resultPayload(item.result);
    if (item.name !== 'get_otif_metrics' || !isRecord(result)) return [];
    return [{
      startDate: result.startDate,
      endDate: result.endDate,
      totalOrders: result.totalOrders,
      otifOrders: result.otifOrders,
      onTimePercentage: result.onTimePercentage,
      inFullPercentage: result.inFullPercentage,
      otifPercentage: result.otifPercentage,
    }];
  });
  const warehouses = observations.flatMap((item) => {
    const result = resultPayload(item.result);
    if (item.name !== 'get_warehouse_performance' || !Array.isArray(result)) return [];
    return result.filter(isRecord).map((row) => ({
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      totalOrders: row.totalOrders,
      otifPercentage: row.otifPercentage,
      lateOrderCount: row.lateOrderCount,
      partialShipmentCount: row.partialShipmentCount,
      startDate: item.arguments.startDate,
      endDate: item.arguments.endDate,
    }));
  });
  const inventory = observations.flatMap((item) => {
    const result = resultPayload(item.result);
    if (item.name !== 'get_inventory_health' || !isRecord(result)) return [];
    const products = Array.isArray(result.affectedProducts) ? result.affectedProducts.filter(isRecord) : [];
    return [{
      startDate: result.startDate,
      endDate: result.endDate,
      productsBelowSafetyStock: result.productsBelowSafetyStock,
      numberOfDaysBelowSafetyStock: result.numberOfDaysBelowSafetyStock,
      affectedProducts: products.slice(0, 12).map((product) => ({
        sku: product.sku,
        productName: product.productName,
        warehouseName: product.warehouseName,
        daysBelowSafetyStock: product.daysBelowSafetyStock,
        lowestQuantityOnHand: product.lowestQuantityOnHand,
        safetyStockTarget: product.safetyStockTarget,
      })),
    }];
  });
  const vendors = observations.flatMap((item) => {
    const result = resultPayload(item.result);
    if (item.name !== 'get_vendor_performance' || !isRecord(result) || !Array.isArray(result.vendors)) return [];
    return result.vendors.filter(isRecord).filter((vendor) => Number(vendor.lateDeliveries ?? 0) > 0).map((vendor) => ({
      vendorName: vendor.vendorName,
      purchaseOrders: vendor.purchaseOrders,
      lateDeliveries: vendor.lateDeliveries,
      onTimePercentage: vendor.onTimePercentage,
      averageDaysLate: vendor.averageDaysLate,
      startDate: item.arguments.startDate,
      endDate: item.arguments.endDate,
      latePurchaseOrders: (Array.isArray(vendor.latePurchaseOrders) ? vendor.latePurchaseOrders : [])
        .filter(isRecord).slice(0, 20).map((po) => ({
          purchaseOrderId: po.purchaseOrderId,
          warehouseName: po.warehouseName,
          productName: po.productName,
          expectedDeliveryDate: po.expectedDeliveryDate,
          actualDeliveryDate: po.actualDeliveryDate,
          daysLate: po.daysLate,
          quantityOrdered: po.quantityOrdered,
          quantityReceived: po.quantityReceived,
        })),
    }));
  });
  const customers = observations.flatMap((item) => {
    const result = resultPayload(item.result);
    if (item.name !== 'get_customer_impact' || !isRecord(result) || !Array.isArray(result.customers)) return [];
    return result.customers.filter(isRecord)
      .sort((a, b) => Number(b.estimatedAffectedRevenue ?? 0) - Number(a.estimatedAffectedRevenue ?? 0))
      .slice(0, 5)
      .map((customer) => ({
        customerName: customer.customerName,
        totalOrders: customer.totalOrders,
        otifPercentage: customer.otifPercentage,
        lateOrders: customer.lateOrders,
        partialOrders: customer.partialOrders,
        estimatedAffectedRevenue: customer.estimatedAffectedRevenue,
      }));
  });

  return {
    toolSequence: observations.map((item, index) => ({ id: index + 1, label: displayToolName(item.name) })),
    toolsUsed: used.map((name) => ({ name, label: displayToolName(name),
      context: name === 'search_company_policies' ? 'policy' : 'operational' })),
    toolTrace: run.toolCalls.map((item, index) => ({
      id: index + 1,
      name: item.name,
      label: displayToolName(item.name),
      arguments: item.arguments,
      summary: item.summary,
      context: item.name === 'search_company_policies' ? 'policy' : 'operational',
    })),
    policySources,
    evidence: { otif, warehouses, inventory, vendors, customers },
  };
}

async function withMcpClient<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: 'supplychain-ai-ui-api', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--env-file-if-exists=.env', '--disable-warning=ExperimentalWarning', '--experimental-strip-types', 'src/mcp/server.ts'],
    cwd: process.cwd(),
    stderr: 'inherit',
  });
  try {
    await client.connect(transport);
    const discovered = await client.listTools();
    const names = new Set(discovered.tools.map((tool) => tool.name));
    if (MCP_TOOLS.some((name) => !names.has(name))) throw new Error('Required local MCP capabilities are unavailable');
    return await work(client);
  } finally {
    await client.close();
  }
}

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error('Local MCP tool call failed');
  const structured = result.structuredContent;
  if (isRecord(structured) && 'result' in structured) return structured.result;
  throw new Error('Local MCP tool returned an unexpected result format');
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

let mcpAvailable = false;
void withMcpClient(async () => true).then(() => { mcpAvailable = true; }).catch(() => { mcpAvailable = false; });

app.get('/api/health', (_request: Request, response: Response) => {
  response.json({ status: mcpAvailable ? 'ready' : 'starting', mcpAgentAvailable: mcpAvailable });
});

app.get('/api/overview', async (_request: Request, response: Response) => {
  try {
    const data = await withMcpClient(async (client) => {
      const [august, july, augustWarehouseRows, julyWarehouseRows] = await Promise.all([
        callTool(client, 'get_otif_metrics', { startDate: '2026-08-01', endDate: '2026-08-31' }),
        callTool(client, 'get_otif_metrics', { startDate: '2026-07-01', endDate: '2026-07-31' }),
        callTool(client, 'get_warehouse_performance', { startDate: '2026-08-01', endDate: '2026-08-31' }),
        callTool(client, 'get_warehouse_performance', { startDate: '2026-07-01', endDate: '2026-07-31' }),
      ]);
      if (!isRecord(august) || !isRecord(july) || !Array.isArray(augustWarehouseRows) || !Array.isArray(julyWarehouseRows)) {
        throw new Error('Unexpected KPI result');
      }
      const julyWarehouses = new Map(julyWarehouseRows.filter(isRecord).map((row) => [row.warehouseId, row]));
      const warehouseComparison = augustWarehouseRows.filter(isRecord).flatMap((row) => {
        const previous = julyWarehouses.get(row.warehouseId);
        if (!previous) return [];
        const changePoints = Math.round((Number(row.otifPercentage) - Number(previous.otifPercentage)) * 10) / 10;
        return [{
          warehouseId: row.warehouseId,
          warehouseName: row.warehouseName,
          julyOtif: previous.otifPercentage,
          augustOtif: row.otifPercentage,
          changePoints,
          julyOrders: previous.totalOrders,
          augustOrders: row.totalOrders,
          julyLateOrders: previous.lateOrderCount,
          augustLateOrders: row.lateOrderCount,
          julyPartialShipments: previous.partialShipmentCount,
          augustPartialShipments: row.partialShipmentCount,
        }];
      });
      const largestDecline = warehouseComparison.length
        ? warehouseComparison.reduce((lowest, current) => current.changePoints < lowest.changePoints ? current : lowest)
        : null;
      const augustWarehouses = augustWarehouseRows.filter(isRecord);
      return {
        augustOtif: august.otifPercentage,
        monthOverMonthChange: Math.round((Number(august.otifPercentage) - Number(july.otifPercentage)) * 10) / 10,
        lateOrders: augustWarehouses.reduce((sum, row) => sum + Number(row.lateOrderCount ?? 0), 0),
        partialShipments: augustWarehouses.reduce((sum, row) => sum + Number(row.partialShipmentCount ?? 0), 0),
        warehouseComparison,
        largestWarehouseDecline: largestDecline,
      };
    });
    response.json(data);
  } catch {
    response.status(503).json({ error: 'Could not load current operational metrics from the local MCP server.' });
  }
});

app.post('/api/investigate', async (request: Request, response: Response) => {
  const body: unknown = request.body;
  const question = isRecord(body) ? body.question : undefined;
  if (typeof question !== 'string' || !question.trim() || question.trim().length > 4000) {
    response.status(400).json({ error: 'Provide a question containing 1 to 4000 characters.' });
    return;
  }
  const observations: ToolObservation[] = [];
  try {
    const result = await runMcpSupplyChainAgent(question, {
      onToolResult: (observation) => observations.push(observation),
    });
    response.json({
      answer: result.answer,
      metadata: buildInvestigationMetadata(observations, result),
    });
  } catch {
    response.status(500).json({ error: 'Investigation failed. Check the local MCP server and API configuration.' });
  }
});

app.listen(API_PORT, API_HOST, () => {
  console.error(`SupplyChain AI UI API listening on http://${API_HOST}:${API_PORT}`);
});
