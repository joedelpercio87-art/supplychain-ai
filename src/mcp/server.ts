import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import {
  getCustomerImpact,
  getInventoryHealth,
  getOtifMetrics,
  getVendorPerformance,
  getWarehousePerformance,
} from '../tools/index.ts';
import { searchCompanyPolicies } from '../context/index.ts';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD date');
const optionalIdSchema = z.number().int().positive().optional();
const outputSchema = z.object({ result: z.unknown() });

function structuredResult(result: unknown): CallToolResult {
  const structuredContent = { result };
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

function buildServer(): McpServer {
  const server = new McpServer({ name: 'supplychain-ai', version: '1.0.0' });

  server.registerTool('get_otif_metrics', {
    title: 'Get OTIF Metrics',
    description: 'Return order-level on-time, in-full, and OTIF metrics over an inclusive date range, optionally filtered by warehouse or customer. Orders are selected by order date.',
    inputSchema: z.object({
      startDate: dateSchema,
      endDate: dateSchema,
      warehouseId: optionalIdSchema,
      customerId: optionalIdSchema,
    }).strict(),
    outputSchema,
  }, async ({ startDate, endDate, warehouseId, customerId }) => structuredResult(
    getOtifMetrics({ startDate, endDate, warehouseId, customerId }),
  ));

  server.registerTool('get_warehouse_performance', {
    title: 'Get Warehouse Performance',
    description: 'Compare warehouse order volume, OTIF percentage, late order count, and partial shipment count for an inclusive date range.',
    inputSchema: z.object({ startDate: dateSchema, endDate: dateSchema }).strict(),
    outputSchema,
  }, async ({ startDate, endDate }) => structuredResult(
    getWarehousePerformance({ startDate, endDate }),
  ));

  server.registerTool('get_inventory_health', {
    title: 'Get Inventory Health',
    description: 'Report products below safety stock, duration below safety stock, lowest quantity on hand, and affected product and warehouse information for an inclusive inventory snapshot date range.',
    inputSchema: z.object({
      startDate: dateSchema,
      endDate: dateSchema,
      warehouseId: optionalIdSchema,
      productId: optionalIdSchema,
    }).strict(),
    outputSchema,
  }, async ({ startDate, endDate, warehouseId, productId }) => structuredResult(
    getInventoryHealth({ startDate, endDate, warehouseId, productId }),
  ));

  server.registerTool('get_vendor_performance', {
    title: 'Get Vendor Performance',
    description: 'Report vendor purchase-order delivery performance for an inclusive expected-delivery date range, including late PO details and receiving warehouse.',
    inputSchema: z.object({
      startDate: dateSchema,
      endDate: dateSchema,
      vendorId: optionalIdSchema,
    }).strict(),
    outputSchema,
  }, async ({ startDate, endDate, vendorId }) => structuredResult(
    getVendorPerformance({ startDate, endDate, vendorId }),
  ));

  server.registerTool('get_customer_impact', {
    title: 'Get Customer Impact',
    description: 'Summarize customer order counts, OTIF, late and partial orders, and estimated affected revenue for an inclusive order-date range, optionally filtered by warehouse.',
    inputSchema: z.object({
      startDate: dateSchema,
      endDate: dateSchema,
      warehouseId: optionalIdSchema,
    }).strict(),
    outputSchema,
  }, async ({ startDate, endDate, warehouseId }) => structuredResult(
    getCustomerImpact({ startDate, endDate, warehouseId }),
  ));

  server.registerTool('search_company_policies', {
    title: 'Search Company Policies',
    description: 'Search approved company policy passages in the local vector index for procedures, escalation requirements, service standards, and policy actions. Does not accept file paths.',
    inputSchema: z.object({
      query: z.string().trim().min(1).max(4000),
      topK: z.number().int().min(1).max(50).optional(),
    }).strict(),
    outputSchema,
  }, async ({ query, topK }) => structuredResult(
    await searchCompanyPolicies(query, { topK }),
  ));

  return server;
}

void serveStdio(buildServer);
console.error('SupplyChain AI MCP server ready on stdio.');
