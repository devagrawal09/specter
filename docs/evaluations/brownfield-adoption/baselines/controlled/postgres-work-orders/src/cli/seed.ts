import { loadConfig } from '../config';
import { createPool } from '../database';
import { loadLocalEnvironment } from '../environment';
import { LEGACY_FIXTURES, seed } from '../seed';

async function main(): Promise<void> {
  loadLocalEnvironment();
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  try {
    await seed(pool, config.DATABASE_URL);
    console.log(`Reconciled ${LEGACY_FIXTURES.length} legacy work orders and related state`);
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
