import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dbPath = resolve(root, process.env.DATABASE_PATH ?? 'data/supplychain.db');
const db = new DatabaseSync(dbPath, { readOnly: true });

const counts = db.prepare(`
  SELECT 'customers' AS table_name, COUNT(*) AS row_count FROM customers UNION ALL
  SELECT 'products', COUNT(*) FROM products UNION ALL
  SELECT 'warehouses', COUNT(*) FROM warehouses UNION ALL
  SELECT 'vendors', COUNT(*) FROM vendors UNION ALL
  SELECT 'orders', COUNT(*) FROM orders UNION ALL
  SELECT 'order_lines', COUNT(*) FROM order_lines UNION ALL
  SELECT 'inventory', COUNT(*) FROM inventory UNION ALL
  SELECT 'purchase_orders', COUNT(*) FROM purchase_orders UNION ALL
  SELECT 'shipments', COUNT(*) FROM shipments
`).all();

const monthlyOtif = db.prepare(`
  SELECT strftime('%Y-%m', o.order_date) AS month,
         COUNT(*) AS orders,
         SUM(CASE WHEN o.actual_ship_date <= o.requested_ship_date
                    AND o.actual_delivery_date <= o.requested_delivery_date
                    AND NOT EXISTS (
                      SELECT 1 FROM order_lines l
                      WHERE l.order_id = o.order_id AND l.quantity_shipped < l.quantity_ordered
                    ) THEN 1 ELSE 0 END) AS otif_orders,
         ROUND(100.0 * SUM(CASE WHEN o.actual_ship_date <= o.requested_ship_date
                    AND o.actual_delivery_date <= o.requested_delivery_date
                    AND NOT EXISTS (
                      SELECT 1 FROM order_lines l
                      WHERE l.order_id = o.order_id AND l.quantity_shipped < l.quantity_ordered
                    ) THEN 1 ELSE 0 END) / COUNT(*), 1) AS otif_percentage
  FROM orders o GROUP BY month ORDER BY month
`).all();

const warehouseOtif = db.prepare(`
  SELECT w.warehouse_name, strftime('%Y-%m', o.order_date) AS month,
         COUNT(*) AS orders,
         ROUND(100.0 * SUM(CASE WHEN o.actual_ship_date <= o.requested_ship_date
                    AND o.actual_delivery_date <= o.requested_delivery_date
                    AND NOT EXISTS (
                      SELECT 1 FROM order_lines l
                      WHERE l.order_id = o.order_id AND l.quantity_shipped < l.quantity_ordered
                    ) THEN 1 ELSE 0 END) / COUNT(*), 1) AS otif_percentage
  FROM orders o JOIN warehouses w USING (warehouse_id)
  GROUP BY w.warehouse_id, month ORDER BY month, w.warehouse_id
`).all();

const vendorAugust = db.prepare(`
  SELECT v.vendor_name, COUNT(*) AS purchase_orders,
         SUM(CASE WHEN po.actual_delivery_date > po.expected_delivery_date THEN 1 ELSE 0 END) AS late_orders,
         ROUND(AVG(julianday(po.actual_delivery_date) - julianday(po.expected_delivery_date)), 1) AS average_days_vs_expected
  FROM purchase_orders po JOIN vendors v USING (vendor_id)
  WHERE strftime('%Y-%m', po.expected_delivery_date) = '2026-08'
  GROUP BY v.vendor_id ORDER BY late_orders DESC, average_days_vs_expected DESC
`).all();

const belowSafety = db.prepare(`
  SELECT w.warehouse_name, COUNT(DISTINCT i.product_id) AS products_below_safety,
         COUNT(*) AS below_safety_product_days,
         MIN(i.inventory_date) AS first_date,
         MAX(i.inventory_date) AS last_date
  FROM inventory i JOIN products p USING (product_id) JOIN warehouses w USING (warehouse_id)
  WHERE i.inventory_date BETWEEN '2026-08-01' AND '2026-08-31'
    AND i.quantity_on_hand < p.safety_stock
  GROUP BY w.warehouse_id ORDER BY products_below_safety DESC
`).all();

const fkViolations = db.prepare('PRAGMA foreign_key_check').all();
console.log('TABLE COUNTS');
console.table(counts);
console.log('MONTHLY ORDER-LEVEL OTIF');
console.table(monthlyOtif);
console.log('WAREHOUSE OTIF BY ORDER MONTH');
console.table(warehouseOtif);
console.log('PURCHASE ORDER PERFORMANCE FOR AUGUST EXPECTED ARRIVALS');
console.table(vendorAugust);
console.log('AUGUST INVENTORY BELOW PRODUCT SAFETY STOCK');
console.table(belowSafety);
console.log(`FOREIGN KEY VIOLATIONS: ${fkViolations.length}`);
if (fkViolations.length) process.exitCode = 1;
db.close();
