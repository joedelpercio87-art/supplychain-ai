# Business intelligence tools

`index.ts` exports five deterministic, synchronous, read-only business tools. They validate date ranges and optional positive integer IDs before calling the SQL data-access functions in `src/database/biQueries.ts`. SQL uses fixed statements and bound parameters; callers cannot supply SQL. Vendor results include each late purchase order joined to its vendor, receiving warehouse, and product, alongside vendor-level metrics.

Run `npm run tools:validate` to exercise the tools against the local seeded database and print JSON examples for August 2026.
