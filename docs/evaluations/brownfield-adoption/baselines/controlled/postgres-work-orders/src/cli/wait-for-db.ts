import { loadConfig } from '../config';
import { createPool } from '../database';
import { loadLocalEnvironment } from '../environment';

const attempts = 30;
const delayMs = 1_000;

async function main(): Promise<void> {
  loadLocalEnvironment();
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  try {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await pool.query('SELECT 1');
        console.log(`Database ready on attempt ${attempt}/${attempts}`);
        return;
      } catch (error) {
        if (attempt === attempts) throw error;
        console.log(`Database not ready on attempt ${attempt}/${attempts}; retrying in ${delayMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error('Database readiness deadline exceeded', error);
  process.exitCode = 1;
});
