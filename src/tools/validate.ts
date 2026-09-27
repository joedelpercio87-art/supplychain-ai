import assert from 'node:assert/strict';
import {
  getCustomerImpact,
  getInventoryHealth,
  getOtifMetrics,
  getVendorPerformance,
  getWarehousePerformance,
} from './index.ts';

const august = { startDate: '2026-08-01', endDate: '2026-08-31' };
const otif = getOtifMetrics(august);
const warehouses = getWarehousePerformance(august);
const inventory = getInventoryHealth(august);
const vendors = getVendorPerformance(august);
const customers = getCustomerImpact(august);

assert.equal(otif.totalOrders, 360);
assert.equal(otif.otifOrders, 229);
assert.equal(warehouses.length, 3);
assert.equal(getOtifMetrics({ ...august, warehouseId: warehouses[0]!.warehouseId }).totalOrders, warehouses[0]!.totalOrders);
assert.ok(inventory.productsBelowSafetyStock > 0);
assert.ok(inventory.numberOfDaysBelowSafetyStock > 0);
assert.equal(getInventoryHealth({ ...august, productId: inventory.affectedProducts[0]!.productId }).productsBelowSafetyStock, 1);
assert.ok(vendors.vendors.some((vendor) => vendor.lateDeliveries > 0));
const lateVendor = vendors.vendors.find((vendor) => vendor.lateDeliveries > 0)!;
assert.equal(lateVendor.latePurchaseOrders.length, lateVendor.lateDeliveries);
assert.ok(lateVendor.latePurchaseOrders.every((po) => po.purchaseOrderId > 0 && po.vendorId === lateVendor.vendorId
  && po.vendorName.length > 0 && po.warehouseId > 0 && po.warehouseName.length > 0
  && po.productId > 0 && po.sku.length > 0 && po.productName.length > 0
  && po.expectedDeliveryDate.length === 10 && (po.actualDeliveryDate === null || po.actualDeliveryDate.length === 10)
  && po.daysLate > 0 && po.quantityOrdered > 0 && po.quantityReceived >= 0));
assert.equal(getVendorPerformance({ ...august, vendorId: lateVendor.vendorId }).vendors.length, 1);
assert.ok(customers.customers.length > 0);
assert.ok(customers.customers.every((customer) => customer.estimatedAffectedRevenue >= 0));
assert.ok(getCustomerImpact({ ...august, warehouseId: warehouses[0]!.warehouseId }).customers.length > 0);
assert.throws(() => getOtifMetrics({ startDate: '2026-02-30', endDate: '2026-03-01' }), /valid calendar date/);
assert.throws(() => getInventoryHealth({ ...august, productId: 0 }), /positive integer/);

console.log('getOtifMetrics');
console.log(JSON.stringify(otif, null, 2));
console.log('getWarehousePerformance');
console.log(JSON.stringify(warehouses, null, 2));
console.log('getInventoryHealth');
console.log(JSON.stringify(inventory, null, 2));
console.log('getVendorPerformance');
console.log(JSON.stringify(vendors, null, 2));
console.log('getCustomerImpact');
console.log(JSON.stringify(customers, null, 2));
console.log('All BI tool validation checks passed.');
