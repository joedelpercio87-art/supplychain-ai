import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import type {
  AffectedInventoryProduct,
  AffectedVendorProduct,
  CustomerImpact,
  InventoryHealth,
  LatePurchaseOrderDetail,
  OtifMetrics,
  VendorPerformance,
  WarehousePerformance,
} from '../tools/types.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dbPath = resolve(root, process.env.DATABASE_PATH ?? 'data/supplychain.db');
type Row = Record<string, SQLOutputValue>;
const asNumber = (value: SQLOutputValue | undefined): number => Number(value ?? 0);
const asString = (value: SQLOutputValue | undefined): string => String(value ?? '');
const round1 = (value: number): number => Math.round(value * 10) / 10;

function query<T>(callback: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec('PRAGMA query_only = ON;');
    return callback(db);
  } finally {
    db.close();
  }
}

export function queryOtifMetrics(input: {
  startDate: string; endDate: string; warehouseId?: number; customerId?: number;
}): OtifMetrics {
  return query((db) => {
    const row = db.prepare(`
      WITH facts AS (
        SELECT o.order_id,
          CASE WHEN o.actual_ship_date IS NOT NULL AND o.actual_ship_date <= o.requested_ship_date
                    AND o.actual_delivery_date IS NOT NULL AND o.actual_delivery_date <= o.requested_delivery_date THEN 1 ELSE 0 END AS on_time,
          CASE WHEN EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id = o.order_id)
                    AND NOT EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id = o.order_id AND l.quantity_shipped < l.quantity_ordered) THEN 1 ELSE 0 END AS in_full
        FROM orders o
        WHERE o.order_date BETWEEN ? AND ?
          AND (? IS NULL OR o.warehouse_id = ?)
          AND (? IS NULL OR o.customer_id = ?)
      )
      SELECT COUNT(*) AS total_orders,
        COALESCE(SUM(on_time), 0) AS on_time_orders,
        COALESCE(SUM(in_full), 0) AS in_full_orders,
        COALESCE(SUM(CASE WHEN on_time = 1 AND in_full = 1 THEN 1 ELSE 0 END), 0) AS otif_orders
      FROM facts
    `).get(input.startDate, input.endDate, input.warehouseId ?? null, input.warehouseId ?? null,
      input.customerId ?? null, input.customerId ?? null) as Row;
    const totalOrders = asNumber(row.total_orders);
    const onTimeOrders = asNumber(row.on_time_orders);
    const inFullOrders = asNumber(row.in_full_orders);
    const otifOrders = asNumber(row.otif_orders);
    const pct = (n: number) => totalOrders ? round1((n / totalOrders) * 100) : 0;
    return {
      startDate: input.startDate, endDate: input.endDate,
      warehouseId: input.warehouseId ?? null, customerId: input.customerId ?? null,
      totalOrders, onTimeOrders, inFullOrders, otifOrders,
      onTimePercentage: pct(onTimeOrders), inFullPercentage: pct(inFullOrders), otifPercentage: pct(otifOrders),
    };
  });
}

export function queryWarehousePerformance(input: { startDate: string; endDate: string }): WarehousePerformance[] {
  return query((db) => {
    const rows = db.prepare(`
      SELECT w.warehouse_id, w.warehouse_name, COUNT(o.order_id) AS total_orders,
        COALESCE(ROUND(100.0 * SUM(CASE WHEN o.actual_ship_date IS NOT NULL AND o.actual_ship_date <= o.requested_ship_date
          AND o.actual_delivery_date IS NOT NULL AND o.actual_delivery_date <= o.requested_delivery_date
          AND EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id = o.order_id)
          AND NOT EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id = o.order_id AND l.quantity_shipped < l.quantity_ordered)
          THEN 1 ELSE 0 END) / NULLIF(COUNT(o.order_id), 0), 1), 0) AS otif_percentage,
        SUM(CASE WHEN o.order_id IS NOT NULL AND (o.actual_ship_date IS NULL OR o.actual_ship_date > o.requested_ship_date
                      OR o.actual_delivery_date IS NULL OR o.actual_delivery_date > o.requested_delivery_date) THEN 1 ELSE 0 END) AS late_order_count,
        SUM(CASE WHEN o.order_id IS NOT NULL AND EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id = o.order_id AND l.quantity_shipped < l.quantity_ordered)
          THEN 1 ELSE 0 END) AS partial_shipment_count
      FROM warehouses w LEFT JOIN orders o ON o.warehouse_id = w.warehouse_id AND o.order_date BETWEEN ? AND ?
      GROUP BY w.warehouse_id, w.warehouse_name ORDER BY w.warehouse_id
    `).all(input.startDate, input.endDate) as Row[];
    return rows.map((row) => ({
      warehouseId: asNumber(row.warehouse_id), warehouseName: asString(row.warehouse_name),
      totalOrders: asNumber(row.total_orders), otifPercentage: asNumber(row.otif_percentage),
      lateOrderCount: asNumber(row.late_order_count), partialShipmentCount: asNumber(row.partial_shipment_count),
    }));
  });
}

export function queryInventoryHealth(input: {
  startDate: string; endDate: string; warehouseId?: number; productId?: number;
}): InventoryHealth {
  return query((db) => {
    const rows = db.prepare(`
      SELECT p.product_id, p.sku, p.product_name, p.category, p.safety_stock,
        w.warehouse_id, w.warehouse_name, COUNT(*) AS days_below,
        MIN(i.quantity_on_hand) AS lowest_quantity
      FROM inventory i JOIN products p USING (product_id) JOIN warehouses w USING (warehouse_id)
      WHERE i.inventory_date BETWEEN ? AND ? AND i.quantity_on_hand < p.safety_stock
        AND (? IS NULL OR i.warehouse_id = ?) AND (? IS NULL OR i.product_id = ?)
      GROUP BY p.product_id, p.sku, p.product_name, p.category, p.safety_stock, w.warehouse_id, w.warehouse_name
      ORDER BY days_below DESC, p.product_id, w.warehouse_id
    `).all(input.startDate, input.endDate, input.warehouseId ?? null, input.warehouseId ?? null,
      input.productId ?? null, input.productId ?? null) as Row[];
    const affectedProducts: AffectedInventoryProduct[] = rows.map((row) => ({
      productId: asNumber(row.product_id), sku: asString(row.sku), productName: asString(row.product_name),
      category: asString(row.category), warehouseId: asNumber(row.warehouse_id), warehouseName: asString(row.warehouse_name),
      daysBelowSafetyStock: asNumber(row.days_below), lowestQuantityOnHand: asNumber(row.lowest_quantity),
      safetyStockTarget: asNumber(row.safety_stock),
    }));
    const numberOfDaysBelowSafetyStock = affectedProducts.reduce((sum, p) => sum + p.daysBelowSafetyStock, 0);
    return {
      startDate: input.startDate, endDate: input.endDate,
      warehouseId: input.warehouseId ?? null, productId: input.productId ?? null,
      productsBelowSafetyStock: new Set(affectedProducts.map((p) => p.productId)).size,
      numberOfDaysBelowSafetyStock,
      lowestQuantityOnHand: affectedProducts.length ? Math.min(...affectedProducts.map((p) => p.lowestQuantityOnHand)) : null,
      affectedProducts,
    };
  });
}

export function queryVendorPerformance(input: {
  startDate: string; endDate: string; vendorId?: number;
}): VendorPerformance[] {
  return query((db) => {
    const vendorRows = db.prepare(`
      SELECT v.vendor_id, v.vendor_name,
        COUNT(po.po_id) AS purchase_orders,
        SUM(CASE WHEN po.po_id IS NOT NULL AND po.actual_delivery_date IS NOT NULL
                       AND po.actual_delivery_date <= po.expected_delivery_date THEN 1 ELSE 0 END) AS on_time_deliveries,
        SUM(CASE WHEN po.po_id IS NOT NULL AND (po.actual_delivery_date > po.expected_delivery_date
                       OR (po.actual_delivery_date IS NULL AND po.expected_delivery_date < ?)) THEN 1 ELSE 0 END) AS late_deliveries,
        ROUND(100.0 * SUM(CASE WHEN po.po_id IS NOT NULL AND po.actual_delivery_date IS NOT NULL
                       AND po.actual_delivery_date <= po.expected_delivery_date THEN 1 ELSE 0 END)
          / NULLIF(COUNT(po.po_id), 0), 1) AS on_time_percentage,
        AVG(CASE WHEN po.po_id IS NOT NULL AND po.actual_delivery_date > po.expected_delivery_date
          THEN julianday(po.actual_delivery_date) - julianday(po.expected_delivery_date)
          WHEN po.po_id IS NOT NULL AND po.actual_delivery_date IS NULL AND po.expected_delivery_date < ?
          THEN julianday(?) - julianday(po.expected_delivery_date) END) AS average_days_late
      FROM vendors v LEFT JOIN purchase_orders po
        ON po.vendor_id = v.vendor_id AND po.expected_delivery_date BETWEEN ? AND ?
      WHERE (? IS NULL OR v.vendor_id = ?)
      GROUP BY v.vendor_id, v.vendor_name ORDER BY v.vendor_id
    `).all(input.endDate, input.endDate, input.endDate, input.startDate, input.endDate,
      input.vendorId ?? null, input.vendorId ?? null) as Row[];

    const productRows = db.prepare(`
      SELECT po.vendor_id, p.product_id, p.sku, p.product_name, COUNT(*) AS late_purchase_orders
      FROM purchase_orders po JOIN products p USING (product_id)
      WHERE po.expected_delivery_date BETWEEN ? AND ? AND (po.actual_delivery_date > po.expected_delivery_date
        OR (po.actual_delivery_date IS NULL AND po.expected_delivery_date < ?))
        AND (? IS NULL OR po.vendor_id = ?)
      GROUP BY po.vendor_id, p.product_id, p.sku, p.product_name
      ORDER BY po.vendor_id, late_purchase_orders DESC, p.product_id
    `).all(input.startDate, input.endDate, input.endDate, input.vendorId ?? null,
      input.vendorId ?? null) as Row[];
    const productsByVendor = new Map<number, AffectedVendorProduct[]>();
    for (const row of productRows) {
      const vendorId = asNumber(row.vendor_id);
      const products = productsByVendor.get(vendorId) ?? [];
      products.push({ productId: asNumber(row.product_id), sku: asString(row.sku),
        productName: asString(row.product_name), latePurchaseOrders: asNumber(row.late_purchase_orders) });
      productsByVendor.set(vendorId, products);
    }
    const detailRows = db.prepare(`
      SELECT po.po_id, v.vendor_id, v.vendor_name, w.warehouse_id, w.warehouse_name,
        p.product_id, p.sku, p.product_name, po.expected_delivery_date, po.actual_delivery_date,
        CASE WHEN po.actual_delivery_date > po.expected_delivery_date
          THEN CAST(julianday(po.actual_delivery_date) - julianday(po.expected_delivery_date) AS INTEGER)
          WHEN po.actual_delivery_date IS NULL AND po.expected_delivery_date < ?
          THEN CAST(julianday(?) - julianday(po.expected_delivery_date) AS INTEGER)
          ELSE 0 END AS days_late,
        po.quantity_ordered, po.quantity_received
      FROM purchase_orders po
      JOIN vendors v USING (vendor_id)
      JOIN warehouses w USING (warehouse_id)
      JOIN products p USING (product_id)
      WHERE po.expected_delivery_date BETWEEN ? AND ?
        AND (po.actual_delivery_date > po.expected_delivery_date
          OR (po.actual_delivery_date IS NULL AND po.expected_delivery_date < ?))
        AND (? IS NULL OR po.vendor_id = ?)
      ORDER BY po.actual_delivery_date DESC, po.po_id
    `).all(input.endDate, input.endDate, input.startDate, input.endDate, input.endDate,
      input.vendorId ?? null, input.vendorId ?? null) as Row[];
    const detailsByVendor = new Map<number, LatePurchaseOrderDetail[]>();
    for (const row of detailRows) {
      const vendorId = asNumber(row.vendor_id);
      const details = detailsByVendor.get(vendorId) ?? [];
      details.push({
        purchaseOrderId: asNumber(row.po_id), vendorId, vendorName: asString(row.vendor_name),
        warehouseId: asNumber(row.warehouse_id), warehouseName: asString(row.warehouse_name),
        productId: asNumber(row.product_id), sku: asString(row.sku), productName: asString(row.product_name),
        expectedDeliveryDate: asString(row.expected_delivery_date),
        actualDeliveryDate: row.actual_delivery_date === null ? null : asString(row.actual_delivery_date),
        daysLate: asNumber(row.days_late), quantityOrdered: asNumber(row.quantity_ordered),
        quantityReceived: asNumber(row.quantity_received),
      });
      detailsByVendor.set(vendorId, details);
    }
    return vendorRows.map((row) => ({
      vendorId: asNumber(row.vendor_id), vendorName: asString(row.vendor_name),
      purchaseOrders: asNumber(row.purchase_orders), onTimeDeliveries: asNumber(row.on_time_deliveries),
      lateDeliveries: asNumber(row.late_deliveries),
      onTimePercentage: row.on_time_percentage === null ? 0 : asNumber(row.on_time_percentage),
      averageDaysLate: round1(asNumber(row.average_days_late)),
      productsAffected: productsByVendor.get(asNumber(row.vendor_id)) ?? [],
      latePurchaseOrders: detailsByVendor.get(asNumber(row.vendor_id)) ?? [],
    }));
  });
}

export function queryCustomerImpact(input: { startDate: string; endDate: string; warehouseId?: number }): CustomerImpact[] {
  return query((db) => {
    const rows = db.prepare(`
      SELECT c.customer_id, c.customer_name, c.customer_segment, c.region, COUNT(*) AS total_orders,
        ROUND(100.0 * SUM(CASE WHEN o.actual_ship_date IS NOT NULL AND o.actual_ship_date <= o.requested_ship_date
          AND o.actual_delivery_date IS NOT NULL AND o.actual_delivery_date <= o.requested_delivery_date
          AND NOT EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id = o.order_id
            AND l.quantity_shipped < l.quantity_ordered) THEN 1 ELSE 0 END) / COUNT(*), 1) AS otif_percentage,
        SUM(CASE WHEN o.actual_ship_date IS NULL OR o.actual_ship_date > o.requested_ship_date
          OR o.actual_delivery_date IS NULL OR o.actual_delivery_date > o.requested_delivery_date THEN 1 ELSE 0 END) AS late_orders,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id = o.order_id
          AND l.quantity_shipped < l.quantity_ordered) THEN 1 ELSE 0 END) AS partial_orders,
        ROUND(SUM(CASE WHEN o.actual_ship_date IS NULL OR o.actual_ship_date > o.requested_ship_date
          OR o.actual_delivery_date IS NULL OR o.actual_delivery_date > o.requested_delivery_date
          OR EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id = o.order_id
            AND l.quantity_shipped < l.quantity_ordered)
          THEN (SELECT SUM(l.quantity_ordered * l.unit_price) FROM order_lines l WHERE l.order_id = o.order_id)
          ELSE 0 END), 2) AS estimated_affected_revenue
      FROM orders o JOIN customers c USING (customer_id)
      WHERE o.order_date BETWEEN ? AND ? AND (? IS NULL OR o.warehouse_id = ?)
      GROUP BY c.customer_id, c.customer_name, c.customer_segment, c.region
      ORDER BY estimated_affected_revenue DESC, c.customer_id
    `).all(input.startDate, input.endDate, input.warehouseId ?? null, input.warehouseId ?? null) as Row[];
    return rows.map((row) => ({
      customerId: asNumber(row.customer_id), customerName: asString(row.customer_name),
      customerSegment: asString(row.customer_segment), region: asString(row.region), totalOrders: asNumber(row.total_orders),
      otifPercentage: asNumber(row.otif_percentage), lateOrders: asNumber(row.late_orders),
      partialOrders: asNumber(row.partial_orders), estimatedAffectedRevenue: asNumber(row.estimated_affected_revenue),
    }));
  });
}
