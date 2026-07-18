import { buildApp } from './app';
import { loadConfig } from './config';
import { createPool, databaseIsReady } from './database';
import { loadLocalEnvironment } from './environment';
import { WorkOrderScheduler } from './scheduler';
import { PostgresWorkOrderStore } from './store';

async function main(): Promise<void> {
  loadLocalEnvironment();
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  const scheduler = new WorkOrderScheduler({
    connectionString: config.DATABASE_URL,
    pool,
    runWorker: config.WORKER_ENABLED,
    dispatchIntervalMs: config.DISPATCH_INTERVAL_MS,
  });
  const app = buildApp({
    store: new PostgresWorkOrderStore(pool),
    dispatchPending: () => scheduler.dispatchPending(),
    ready: async () => {
      const [databaseReady, schedulerReady] = await Promise.all([
        databaseIsReady(pool),
        scheduler.isReady(),
      ]);
      return databaseReady && schedulerReady;
    },
    logger: { level: config.LOG_LEVEL },
  });

  let stopping = false;
  const shutdown = async (exitCode: number): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await app.close().catch(() => undefined);
    await scheduler.stop().catch(() => undefined);
    await pool.end().catch(() => undefined);
    process.exitCode = exitCode;
  };

  process.once('SIGINT', () => void shutdown(0));
  process.once('SIGTERM', () => void shutdown(0));

  try {
    await scheduler.start();
    await app.listen({ host: config.HOST, port: config.PORT, listenTextResolver: () => '' });
    app.log.info({ host: config.HOST, port: config.PORT }, 'work order service listening');
  } catch (error) {
    app.log.error({ err: error }, 'service startup failed');
    await shutdown(1);
    throw error;
  }
}

void main().catch(() => {
  process.exitCode = 1;
});
