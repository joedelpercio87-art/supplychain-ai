import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const databasePath = resolve(
  process.env.DATABASE_PATH ?? 'data/supplychain.db'
);

const indexPath = resolve('data/vector-index/policy-index.json');

function run(script) {
  const result = spawnSync('npm', ['run', script], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(`Startup preparation failed: ${script}`);
  }
}

if (!existsSync(databasePath)) {
  console.log('Initializing synthetic supply chain database...');
  run('db:init');
  run('db:seed');
} else {
  console.log('Existing supply chain database found.');
}

if (!existsSync(indexPath)) {
  console.log('Generating RAG policy index...');
  run('rag:index');
} else {
  console.log('Existing RAG policy index found.');
}

console.log('Supply Chain AI startup preparation complete.');
