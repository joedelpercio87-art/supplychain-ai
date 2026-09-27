import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const dbPath = resolve(root, process.env.DATABASE_PATH ?? 'data/supplychain.db');
const schema = readFileSync(resolve(here, 'schema.sql'), 'utf8');
const reset = process.argv.includes('--reset');

if (reset) rmSync(dbPath, { force: true });
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE;');
db.exec(schema);
db.exec('BEGIN IMMEDIATE;');

const rng = (seed: number) => {
  let state = seed >>> 0;
  return () => { state = (1664525 * state + 1013904223) >>> 0; return state / 4294967296; };
};
const random = rng(20260927);
const int = (min: number, max: number) => Math.floor(random() * (max - min + 1)) + min;
const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)]!;
const roundMoney = (n: number) => Math.round(n * 100) / 100;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => { const d = new Date(date); d.setUTCDate(d.getUTCDate() + days); return d; };
const dateAt = (month: number, day: number) => new Date(Date.UTC(2026, month - 1, day));

const seed = () => {
  const customers = [
    ['Acme Markets', 'Enterprise', 'Northeast', .96], ['Northstar Foods', 'Enterprise', 'Midwest', .97], ['FreshWay Grocers', 'Enterprise', 'South', .96], ['Pioneer Retail Group', 'Enterprise', 'West', .95], ['Greenfield Supply', 'Strategic', 'Midwest', .95], ['Metro Hospitality', 'Strategic', 'Northeast', .94], ['Summit Stores', 'Strategic', 'West', .94], ['Coastal Provisions', 'Strategic', 'South', .95], ['Cornerstone Shops', 'Mid-market', 'Northeast', .92], ['Bluebird Wholesale', 'Mid-market', 'South', .93], ['Red River Co-op', 'Mid-market', 'Midwest', .92], ['Cedar & Pine', 'Mid-market', 'West', .92], ['Harbor Housewares', 'Mid-market', 'Northeast', .91], ['Prairie Home', 'Mid-market', 'Midwest', .91], ['Sunbelt Supply', 'Mid-market', 'South', .92], ['Westmark Goods', 'Mid-market', 'West', .91], ['Maple Street Market', 'Small Business', 'Northeast', .90], ['Lakeside Depot', 'Small Business', 'Midwest', .90], ['Canyon Outfitters', 'Small Business', 'West', .89], ['Palmetto General', 'Small Business', 'South', .90],
  ];
  const products: { id: number; sku: string; name: string; category: string; cost: number; price: number; safety: number; critical: boolean }[] = [];
  const categories = ['Beverages', 'Cleaning', 'Paper Goods', 'Pantry', 'Personal Care'];
  const productNames = ['Sparkling Water', 'Ground Coffee', 'Paper Towels', 'Dish Soap', 'Granola Bars', 'All-Purpose Cleaner', 'Canned Tomatoes', 'Laundry Detergent', 'Facial Tissue', 'Olive Oil', 'Hand Soap', 'Trail Mix', 'Trash Bags', 'Pasta', 'Shampoo', 'Bottled Juice', 'Foil Wrap', 'Oatmeal', 'Surface Wipes', 'Tea Bags'];
  const vendors = ['Apex Consumer Products', 'Blue Ridge Manufacturing', 'Crown Valley Supply', 'Delta Household Goods', 'Evergreen Brands', 'Frontier Foods', 'Gulf Coast Packaging', 'Highland Essentials', 'Ironwood Distributors', 'Juniper Imports'];
  const warehouses = [['Chicago Distribution Center', 'Joliet', 'IL'], ['Houston Regional Hub', 'Houston', 'TX'], ['Reno Western Fulfillment', 'Reno', 'NV']];
  const ins = (sql: string, rows: unknown[][]) => { const stmt = db.prepare(sql); for (const row of rows) stmt.run(...row as (string | number | null)[]); };
  ins('INSERT INTO customers VALUES (?, ?, ?, ?, ?)', customers.map((c, i) => [i + 1, ...c]));
  ins('INSERT INTO warehouses VALUES (?, ?, ?, ?)', warehouses.map((w, i) => [i + 1, ...w]));
  ins('INSERT INTO vendors VALUES (?, ?, ?, ?)', vendors.map((v, i) => [i + 1, v, [8, 10, 12, 14, 9, 11, 13, 7, 15, 10][i]!, i === 3 ? .94 : .93]));
  for (let i = 0; i < 50; i++) {
    const cost = roundMoney(3 + random() * 42);
    const category = categories[i % categories.length]!;
    const name = `${productNames[i % productNames.length]}${i >= 20 ? ` ${Math.floor(i / 20) + 1}` : ''}`;
    products.push({ id: i + 1, sku: `SKU-${String(i + 1).padStart(4, '0')}`, name, category, cost, price: roundMoney(cost * (1.35 + random() * .65)), safety: 45 + (i < 10 ? 85 : int(0, 75)), critical: i < 10 });
  }
  ins('INSERT INTO products VALUES (?, ?, ?, ?, ?, ?, ?)', products.map(p => [p.id, p.sku, p.name, p.category, p.cost, p.price, p.safety]));

  // Vendor 4 supplies the ten highest-volume SKUs. Its August receipts arrive well after plan.
  const pos: { id: number; vendor: number; product: number; wh: number; order: Date; expected: Date; actual: Date; qty: number }[] = [];
  let poId = 1;
  for (let productId = 1; productId <= 50; productId++) {
    const vendorId = productId <= 10 ? 4 : ((productId - 1) % 9) + 1;
    for (const wh of [1, 2, 3]) {
      const expected = dateAt(7, 15 + (productId % 10));
      const orderDate = addDays(expected, -vendorsLead(vendorId));
      const actual = addDays(expected, int(0, 2));
      pos.push({ id: poId++, vendor: vendorId, product: productId, wh, order: orderDate, expected, actual, qty: 150 + int(0, 160) });
    }
    // Replenishment expected in early August; these ten receipts from vendor 4 are late.
    if (productId <= 10) {
      const expected = dateAt(8, 5 + (productId % 4));
      pos.push({ id: poId++, vendor: 4, product: productId, wh: 2, order: addDays(expected, -12), expected, actual: dateAt(8, 27 + (productId % 3)), qty: 300 + int(0, 180) });
      // September catch-up replenishment restores the affected location.
      const sepExpected = dateAt(9, 5 + (productId % 5));
      pos.push({ id: poId++, vendor: 4, product: productId, wh: 2, order: addDays(sepExpected, -12), expected: sepExpected, actual: addDays(sepExpected, int(0, 2)), qty: 340 + int(0, 160) });
    }
  }
  ins('INSERT INTO purchase_orders VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', pos.map(p => [p.id, p.vendor, p.product, p.wh, iso(p.order), iso(p.expected), iso(p.actual), p.qty, p.qty]));

  // Daily inventory snapshots show the same SKU group under safety stock at Houston in August.
  const invRows: unknown[][] = [];
  let invId = 1;
  for (let day = dateAt(7, 1); day <= dateAt(9, 30); day = addDays(day, 1)) {
    const month = day.getUTCMonth() + 1;
    const dom = day.getUTCDate();
    for (let wh = 1; wh <= 3; wh++) for (const p of products) {
      let qty = Math.round(p.safety * (1.55 + random() * .9));
      if (wh === 2 && p.critical && month === 8 && dom >= 7 && dom <= 26) qty = Math.round(p.safety * (.26 + random() * .25));
      if (wh === 2 && p.critical && month === 8 && dom >= 27) qty = Math.round(p.safety * (1.2 + random() * .25));
      const allocated = Math.min(qty, Math.floor(qty * (.15 + random() * .22)));
      invRows.push([invId++, wh, p.id, iso(day), qty, allocated]);
    }
  }
  ins('INSERT INTO inventory VALUES (?, ?, ?, ?, ?, ?)', invRows);

  const orderRows: unknown[][] = [];
  const lineRows: unknown[][] = [];
  const shipmentRows: unknown[][] = [];
  const whOutcome = new Map<number, { total: number; otif: number }>([[1, { total: 0, otif: 0 }], [2, { total: 0, otif: 0 }], [3, { total: 0, otif: 0 }]]);
  const monthOutcome = new Map<number, { total: number; otif: number }>([[7, { total: 0, otif: 0 }], [8, { total: 0, otif: 0 }], [9, { total: 0, otif: 0 }]]);
  const lineInsert = db.prepare('INSERT INTO order_lines VALUES (?, ?, ?, ?, ?, ?)');
  let lineId = 1;
  for (let id = 1; id <= 1000; id++) {
    const dayOffset = id - 1;
    // 1,000 evenly spread orders across the quarter; keeps September deliveries in-quarter.
    const orderDate = addDays(dateAt(7, 1), Math.floor(dayOffset * 86 / 1000));
    const month = orderDate.getUTCMonth() + 1;
    const wh = int(1, 3);
    const requestedShip = addDays(orderDate, int(1, 2));
    const requestedDelivery = addDays(requestedShip, int(2, 4));
    const customerId = int(1, 20);
    const nLines = int(1, 4);
    const chosen = new Set<number>();
    while (chosen.size < nLines) chosen.add(random() < .69 ? int(1, 10) : int(11, 50));
    const lineSpec = [...chosen].map(productId => ({ product: products[productId - 1]!, qty: int(3, 24) }));
    const isImpacted = month === 8 && wh === 2 && lineSpec.some(l => l.product.critical);
    const failure = isImpacted ? random() < .72 : random() < (month === 8 ? .09 : .055);
    const late = failure ? true : random() < (month === 8 ? .035 : .025);
    const partial = isImpacted && failure && random() < .55;
    const shipDate = addDays(requestedShip, late ? int(1, 4) : -int(0, 1));
    const deliveryDate = addDays(requestedDelivery, failure ? int(1, 4) : -int(0, 1));
    orderRows.push([id, customerId, wh, iso(orderDate), iso(requestedShip), iso(shipDate), iso(requestedDelivery), iso(deliveryDate), partial ? 'partially_fulfilled' : 'delivered']);
    for (const line of lineSpec) {
      const shipped = partial && line.product.critical ? Math.max(1, Math.floor(line.qty * .45)) : line.qty;
      lineRows.push([lineId++, id, line.product.id, line.qty, shipped, line.product.price]);
    }
    shipmentRows.push([id, id, pick(['NorthStar Freight', 'Pioneer Logistics', 'Atlas Parcel', 'BlueLine Transport']), iso(shipDate), iso(deliveryDate), roundMoney(18 + random() * 110), partial ? 'partially_delivered' : 'delivered']);
    const isOtif = !late && !partial && deliveryDate <= requestedDelivery;
    monthOutcome.get(month)!.total++;
    whOutcome.get(wh)!.total++;
    if (isOtif) { monthOutcome.get(month)!.otif++; whOutcome.get(wh)!.otif++; }
  }
  ins('INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', orderRows);
  ins('INSERT INTO shipments VALUES (?, ?, ?, ?, ?, ?, ?)', shipmentRows);
  ins('INSERT INTO order_lines VALUES (?, ?, ?, ?, ?, ?)', lineRows);

  console.log('Synthetic orders were generated.');
  console.log(`Monthly order-level OTIF: ${[...monthOutcome].map(([m, x]) => `${m}: ${((x.otif / x.total) * 100).toFixed(1)}%`).join(', ')}`);
  console.log(`Warehouse OTIF: ${[...whOutcome].map(([w, x]) => `${w}: ${((x.otif / x.total) * 100).toFixed(1)}%`).join(', ')}`);
  db.exec('COMMIT;');
};

function vendorsLead(vendorId: number): number { return [8, 10, 12, 14, 9, 11, 13, 7, 15, 10][vendorId - 1]!; }

try {
  seed();
} catch (error) {
  db.exec('ROLLBACK;');
  throw error;
} finally {
  db.close();
}
