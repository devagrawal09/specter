import { Pool } from 'pg';

export function createPool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 1_000,
    query_timeout: 2_000,
    idleTimeoutMillis: 10_000,
    application_name: 'postgres-work-orders',
  });
  // pg emits errors from idle pooled clients when PostgreSQL disappears. Listening
  // keeps an expected outage from becoming an uncaught EventEmitter exception.
  pool.on('error', () => undefined);
  return pool;
}

export async function databaseIsReady(pool: Pool): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
