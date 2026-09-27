export interface DateRangeInput {
  startDate: string;
  endDate: string;
}

export interface GetOtifMetricsInput extends DateRangeInput {
  warehouseId?: number;
  customerId?: number;
}

export interface OtifMetrics {
  startDate: string;
  endDate: string;
  warehouseId: number | null;
  customerId: number | null;
  totalOrders: number;
  onTimeOrders: number;
  inFullOrders: number;
  otifOrders: number;
  onTimePercentage: number;
  inFullPercentage: number;
  otifPercentage: number;
}

export interface WarehousePerformanceInput extends DateRangeInput {}

export interface WarehousePerformance {
  warehouseId: number;
  warehouseName: string;
  totalOrders: number;
  otifPercentage: number;
  lateOrderCount: number;
  partialShipmentCount: number;
}

export interface GetInventoryHealthInput extends DateRangeInput {
  warehouseId?: number;
  productId?: number;
}

export interface AffectedInventoryProduct {
  productId: number;
  sku: string;
  productName: string;
  category: string;
  warehouseId: number;
  warehouseName: string;
  daysBelowSafetyStock: number;
  lowestQuantityOnHand: number;
  safetyStockTarget: number;
}

export interface InventoryHealth {
  startDate: string;
  endDate: string;
  warehouseId: number | null;
  productId: number | null;
  productsBelowSafetyStock: number;
  numberOfDaysBelowSafetyStock: number;
  lowestQuantityOnHand: number | null;
  affectedProducts: AffectedInventoryProduct[];
}

export interface GetVendorPerformanceInput extends DateRangeInput {
  vendorId?: number;
}

export interface AffectedVendorProduct {
  productId: number;
  sku: string;
  productName: string;
  latePurchaseOrders: number;
}

export interface LatePurchaseOrderDetail {
  purchaseOrderId: number;
  vendorId: number;
  vendorName: string;
  warehouseId: number;
  warehouseName: string;
  productId: number;
  sku: string;
  productName: string;
  expectedDeliveryDate: string;
  actualDeliveryDate: string | null;
  daysLate: number;
  quantityOrdered: number;
  quantityReceived: number;
}

export interface VendorPerformance {
  vendorId: number;
  vendorName: string;
  purchaseOrders: number;
  onTimeDeliveries: number;
  lateDeliveries: number;
  onTimePercentage: number;
  averageDaysLate: number;
  productsAffected: AffectedVendorProduct[];
  latePurchaseOrders: LatePurchaseOrderDetail[];
}

export interface VendorPerformanceResult {
  startDate: string;
  endDate: string;
  vendorId: number | null;
  vendors: VendorPerformance[];
}

export interface GetCustomerImpactInput extends DateRangeInput {
  warehouseId?: number;
}

export interface CustomerImpact {
  customerId: number;
  customerName: string;
  customerSegment: string;
  region: string;
  totalOrders: number;
  otifPercentage: number;
  lateOrders: number;
  partialOrders: number;
  estimatedAffectedRevenue: number;
}

export interface CustomerImpactResult {
  startDate: string;
  endDate: string;
  warehouseId: number | null;
  customers: CustomerImpact[];
}
