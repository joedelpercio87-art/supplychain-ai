import {
  queryCustomerImpact,
  queryInventoryHealth,
  queryOtifMetrics,
  queryVendorPerformance,
  queryWarehousePerformance,
} from '../database/biQueries.ts';
import { validateDateRange, validateOptionalId } from './validation.ts';
import type {
  CustomerImpactResult,
  GetCustomerImpactInput,
  GetInventoryHealthInput,
  GetOtifMetricsInput,
  GetVendorPerformanceInput,
  InventoryHealth,
  OtifMetrics,
  VendorPerformanceResult,
  WarehousePerformance,
  WarehousePerformanceInput,
} from './types.ts';

export function getOtifMetrics(input: GetOtifMetricsInput): OtifMetrics {
  validateDateRange(input);
  validateOptionalId(input.warehouseId, 'warehouseId');
  validateOptionalId(input.customerId, 'customerId');
  return queryOtifMetrics(input);
}

export function getWarehousePerformance(input: WarehousePerformanceInput): WarehousePerformance[] {
  validateDateRange(input);
  return queryWarehousePerformance(input);
}

export function getInventoryHealth(input: GetInventoryHealthInput): InventoryHealth {
  validateDateRange(input);
  validateOptionalId(input.warehouseId, 'warehouseId');
  validateOptionalId(input.productId, 'productId');
  return queryInventoryHealth(input);
}

export function getVendorPerformance(input: GetVendorPerformanceInput): VendorPerformanceResult {
  validateDateRange(input);
  validateOptionalId(input.vendorId, 'vendorId');
  return { startDate: input.startDate, endDate: input.endDate, vendorId: input.vendorId ?? null,
    vendors: queryVendorPerformance(input) };
}

export function getCustomerImpact(input: GetCustomerImpactInput): CustomerImpactResult {
  validateDateRange(input);
  validateOptionalId(input.warehouseId, 'warehouseId');
  return { startDate: input.startDate, endDate: input.endDate, warehouseId: input.warehouseId ?? null,
    customers: queryCustomerImpact(input) };
}

export type {
  AffectedInventoryProduct,
  AffectedVendorProduct,
  CustomerImpact,
  CustomerImpactResult,
  DateRangeInput,
  GetCustomerImpactInput,
  GetInventoryHealthInput,
  GetOtifMetricsInput,
  GetVendorPerformanceInput,
  InventoryHealth,
  LatePurchaseOrderDetail,
  OtifMetrics,
  VendorPerformance,
  VendorPerformanceResult,
  WarehousePerformance,
  WarehousePerformanceInput,
} from './types.ts';
