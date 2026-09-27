import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const dbPath = resolve(root, process.env.DATABASE_PATH ?? 'data/supplychain.db');
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
try {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(resolve(here, 'schema.sql'), 'utf8'));
  console.log(`Initialized schema at ${dbPath}`);
} finally {
  db.close();
}
