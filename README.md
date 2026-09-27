# Supply Chain AI

A local synthetic distribution dataset for demonstrating supply chain context engineering and root cause analysis. The repository includes a SQLite schema and deterministic Node.js/TypeScript data generation; it does not include an AI agent.

## Requirements

- Node.js 24 or later (uses Node's built-in `node:sqlite` and TypeScript type stripping)
- npm

## Create and seed the database

```sh
npm install
npm run db:init
npm run db:seed
npm run db:validate
```

The database is created at `data/supplychain.db`. `db:init` creates the schema and leaves existing rows intact. `db:seed` recreates the database and deterministically seeds the full synthetic quarter, so running it again produces the same dataset. To use another location, set `DATABASE_PATH` in `.env` (start with `.env.example`).

`npm run typecheck` checks the TypeScript files without creating output files. The seed generator uses a fixed random seed so validation and demonstrations are repeatable.

## Business intelligence tools

`src/tools/index.ts` exports typed, read-only query tools for OTIF, warehouse performance, inventory health, vendor performance, and customer impact. SQL stays in `src/database/biQueries.ts`; tool inputs are validated and values are passed with SQLite parameters. Run `npm run tools:validate` to exercise all five tools, their optional filters, and invalid-input handling against the seeded database.

Tool date ranges are inclusive. Order tools filter by `order_date`, inventory health filters by snapshot date, and vendor performance filters by expected delivery date. OTIF requires shipping by the requested ship date, delivery by the requested delivery date, and every line shipped in full. Estimated affected revenue sums ordered line value for late or partial orders.

## Data and reporting

The schema is in `src/database/schema.sql`; initialization, seeding, and validation are in `src/database/`. The dataset covers July through September 2026 and includes 20 customers, 50 products, 3 warehouses, 10 vendors, 1,000 customer orders, line items, daily inventory snapshots, purchase orders, and shipments.

The synthetic records contain an operational disruption whose cause is discoverable by joining vendor receipts, inventory snapshots, and customer fulfillment. There is no root cause field. `db:validate` reports row counts, order-level monthly OTIF, warehouse OTIF by month, August purchase order lateness, below-safety inventory, and foreign key violations.

OTIF is calculated at the customer order level: an order is on time and in full when it ships by its requested ship date, arrives by its requested delivery date, and every order line is shipped in full.
