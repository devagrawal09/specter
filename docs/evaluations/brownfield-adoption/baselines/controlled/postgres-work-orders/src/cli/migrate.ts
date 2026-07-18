import { loadConfig } from '../config';
import { createPool } from '../database';
import { loadLocalEnvironment } from '../environment';
import { migrate } from '../migrations';

async function main(): Promise<void> {
  loadLocalEnvironment();
  const direction = process.argv[2];
  if (direction !== 'up' && direction !== 'down') {
    throw new Error('Usage: migrate.ts <up|down>');
  }
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  try {
    const completed = await migrate(pool, direction);
    if (completed.length === 0) {
      console.log(`No ${direction} migrations to run`);
    } else {
      for (const migration of completed) console.log(migration);
    }
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
