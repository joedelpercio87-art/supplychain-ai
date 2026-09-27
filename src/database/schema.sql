PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customers (
  customer_id INTEGER PRIMARY KEY,
  customer_name TEXT NOT NULL,
  customer_segment TEXT NOT NULL,
  region TEXT NOT NULL,
  service_level_target REAL NOT NULL CHECK (service_level_target BETWEEN 0 AND 1)
);

CREATE TABLE IF NOT EXISTS products (
  product_id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  product_name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit_cost REAL NOT NULL CHECK (unit_cost >= 0),
  unit_price REAL NOT NULL CHECK (unit_price >= unit_cost),
  safety_stock INTEGER NOT NULL CHECK (safety_stock >= 0)
);

CREATE TABLE IF NOT EXISTS warehouses (
  warehouse_id INTEGER PRIMARY KEY,
  warehouse_name TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vendors (
  vendor_id INTEGER PRIMARY KEY,
  vendor_name TEXT NOT NULL,
  average_lead_time_days INTEGER NOT NULL,
  target_ontime_percentage REAL NOT NULL CHECK (target_ontime_percentage BETWEEN 0 AND 1)
);

CREATE TABLE IF NOT EXISTS orders (
  order_id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(customer_id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(warehouse_id),
  order_date TEXT NOT NULL,
  requested_ship_date TEXT NOT NULL,
  actual_ship_date TEXT,
  requested_delivery_date TEXT NOT NULL,
  actual_delivery_date TEXT,
  order_status TEXT NOT NULL CHECK (order_status IN ('delivered', 'partially_fulfilled'))
);

CREATE TABLE IF NOT EXISTS order_lines (
  order_line_id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(product_id),
  quantity_ordered INTEGER NOT NULL CHECK (quantity_ordered > 0),
  quantity_shipped INTEGER NOT NULL CHECK (quantity_shipped >= 0 AND quantity_shipped <= quantity_ordered),
  unit_price REAL NOT NULL CHECK (unit_price >= 0)
);

CREATE TABLE IF NOT EXISTS inventory (
  inventory_id INTEGER PRIMARY KEY,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(warehouse_id),
  product_id INTEGER NOT NULL REFERENCES products(product_id),
  inventory_date TEXT NOT NULL,
  quantity_on_hand INTEGER NOT NULL CHECK (quantity_on_hand >= 0),
  quantity_allocated INTEGER NOT NULL CHECK (quantity_allocated >= 0 AND quantity_allocated <= quantity_on_hand),
  UNIQUE (warehouse_id, product_id, inventory_date)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  po_id INTEGER PRIMARY KEY,
  vendor_id INTEGER NOT NULL REFERENCES vendors(vendor_id),
  product_id INTEGER NOT NULL REFERENCES products(product_id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(warehouse_id),
  order_date TEXT NOT NULL,
  expected_delivery_date TEXT NOT NULL,
  actual_delivery_date TEXT,
  quantity_ordered INTEGER NOT NULL CHECK (quantity_ordered > 0),
  quantity_received INTEGER NOT NULL CHECK (quantity_received >= 0 AND quantity_received <= quantity_ordered)
);

CREATE TABLE IF NOT EXISTS shipments (
  shipment_id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(order_id) ON DELETE CASCADE,
  carrier TEXT NOT NULL,
  ship_date TEXT,
  delivery_date TEXT,
  shipping_cost REAL NOT NULL CHECK (shipping_cost >= 0),
  shipment_status TEXT NOT NULL CHECK (shipment_status IN ('delivered', 'partially_delivered'))
);

CREATE INDEX IF NOT EXISTS idx_orders_order_date ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_orders_warehouse_dates ON orders(warehouse_id, order_date);
CREATE INDEX IF NOT EXISTS idx_lines_order ON order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_inventory_lookup ON inventory(warehouse_id, product_id, inventory_date);
CREATE INDEX IF NOT EXISTS idx_po_vendor_dates ON purchase_orders(vendor_id, expected_delivery_date, actual_delivery_date);
