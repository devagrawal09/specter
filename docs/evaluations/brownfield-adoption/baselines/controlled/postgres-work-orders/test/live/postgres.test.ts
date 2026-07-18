import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { migrate } from '../../src/migrations';
import { WorkOrderScheduler } from '../../src/scheduler';
import { LEGACY_FIXTURES, seed } from '../../src/seed';
import { PostgresWorkOrderStore } from '../../src/store';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://work_orders:work_orders@127.0.0.1:55431/work_orders';
const liveEnabled = process.env.RUN_LIVE_TESTS === '1';

async function waitFor(
  assertion: () => Promise<boolean>,
  description: string,
  timeoutMs = 12_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

describe.skipIf(!liveEnabled)('live PostgreSQL, queue, and restart behavior', () => {
  const pool = new Pool({ connectionString });
  const schedulers: WorkOrderScheduler[] = [];
  const apps: FastifyInstance[] = [];

  const startScheduler = async (runWorker: boolean): Promise<WorkOrderScheduler> => {
    const scheduler = new WorkOrderScheduler({
      connectionString,
      pool,
      runWorker,
      dispatchIntervalMs: 100,
    });
    await scheduler.start();
    schedulers.push(scheduler);
    return scheduler;
  };

  const makeApp = (scheduler: WorkOrderScheduler): FastifyInstance => {
    const app = buildApp({
      store: new PostgresWorkOrderStore(pool),
      dispatchPending: () => scheduler.dispatchPending(),
    });
    apps.push(app);
    return app;
  };

  beforeAll(async () => {
    await migrate(pool, 'up');
  });

  beforeEach(async () => {
    await seed(pool, connectionString);
  });

  afterEach(async () => {
    while (apps.length > 0) await apps.pop()!.close();
    while (schedulers.length > 0) await schedulers.pop()!.stop();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('reconciles all fixture-related rows when the seed is rerun', async () => {
    await seed(pool, connectionString);
    const ids = LEGACY_FIXTURES.map((fixture) => fixture.id);
    const counts = await pool.query<{
      work_orders: string;
      history: string;
      events: string;
      deliveries: string;
      jobs: string;
    }>(
      `SELECT
         (SELECT count(*) FROM work_orders WHERE id = ANY($1::text[])) AS work_orders,
         (SELECT count(*) FROM work_order_history WHERE work_order_id = ANY($1::text[])) AS history,
         (SELECT count(*) FROM application_events WHERE aggregate_id = ANY($1::text[])) AS events,
         (SELECT count(*) FROM notification_deliveries WHERE work_order_id = ANY($1::text[])) AS deliveries,
         (SELECT count(*) FROM pgboss.job
           WHERE data ->> 'workOrderId' = ANY($1::text[])) AS jobs`,
      [ids],
    );
    expect(counts.rows[0]).toEqual({
      work_orders: '6',
      history: '6',
      events: '0',
      deliveries: '0',
      jobs: '0',
    });
  });

  it('persists close state, history, and event atomically and executes the shared worker', async () => {
    const scheduler = await startScheduler(true);
    const app = makeApp(scheduler);

    const before = await app.inject({ method: 'GET', url: '/work-orders/WO-1001' });
    expect(before.json().data.workOrder.status).toBe('in_progress');

    const response = await app.inject({
      method: 'POST',
      url: '/work-orders/WO-1001/close',
      payload: { requestedBy: 'live-test' },
    });
    expect(response.statusCode).toBe(200);
    const eventId = response.json().data.eventId as string;

    const durable = await pool.query<{
      status: string;
      history_count: string;
      event_count: string;
    }>(
      `SELECT w.status,
         (SELECT count(*) FROM work_order_history h
           WHERE h.work_order_id = w.id AND h.action = 'closed') AS history_count,
         (SELECT count(*) FROM application_events e
           WHERE e.aggregate_id = w.id AND e.event_type = 'WorkOrderClosed') AS event_count
       FROM work_orders w WHERE w.id = 'WO-1001'`,
    );
    expect(durable.rows[0]).toEqual({ status: 'closed', history_count: '1', event_count: '1' });

    const reader = await app.inject({ method: 'GET', url: '/work-orders/WO-1001' });
    expect(reader.json().data.workOrder).toEqual(response.json().data.workOrder);

    await waitFor(async () => {
      const delivered = await pool.query('SELECT 1 FROM notification_deliveries WHERE event_id = $1', [
        eventId,
      ]);
      return delivered.rowCount === 1;
    }, 'close notification delivery');
  });

  it('returns database-backed candidate rejection envelopes', async () => {
    const scheduler = await startScheduler(false);
    const app = makeApp(scheduler);
    for (const [id, code] of [
      ['WO-1002', 'INVALID_STATUS'],
      ['WO-1003', 'INSPECTION_REQUIRED'],
      ['WO-1004', 'ALREADY_CLOSED'],
      ['WO-1005', 'INVALID_STATUS'],
    ] as const) {
      const response = await app.inject({ method: 'POST', url: `/work-orders/${id}/close`, payload: {} });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ ok: false, error: { code } });
    }
    const rejectedIds = ['WO-1002', 'WO-1003', 'WO-1004', 'WO-1005'];
    const sideEffects = await pool.query<{ history_count: string; event_count: string }>(
      `SELECT
         (SELECT count(*) FROM work_order_history
           WHERE work_order_id = ANY($1::text[]) AND action = 'closed') AS history_count,
         (SELECT count(*) FROM application_events
           WHERE aggregate_id = ANY($1::text[]) AND event_type = 'WorkOrderClosed') AS event_count`,
      [rejectedIds],
    );
    expect(sideEffects.rows[0]).toEqual({ history_count: '0', event_count: '0' });
  });

  it('serializes concurrent close decisions against persisted state', async () => {
    const scheduler = await startScheduler(false);
    const app = makeApp(scheduler);
    const responses = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/work-orders/WO-1001/close',
        payload: { requestedBy: 'concurrent-a' },
      }),
      app.inject({
        method: 'POST',
        url: '/work-orders/WO-1001/close',
        payload: { requestedBy: 'concurrent-b' },
      }),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.statusCode === 409)!.json()).toMatchObject({
      ok: false,
      error: { code: 'ALREADY_CLOSED' },
    });

    const rows = await pool.query<{ history_count: string; event_count: string }>(
      `SELECT
         (SELECT count(*) FROM work_order_history
           WHERE work_order_id = 'WO-1001' AND action = 'closed') AS history_count,
         (SELECT count(*) FROM application_events
           WHERE aggregate_id = 'WO-1001' AND event_type = 'WorkOrderClosed') AS event_count`,
    );
    expect(rows.rows[0]).toEqual({ history_count: '1', event_count: '1' });
  });

  it('delivers a persisted job after the scheduler is restarted', async () => {
    const firstScheduler = await startScheduler(false);
    const firstApp = makeApp(firstScheduler);
    const response = await firstApp.inject({
      method: 'POST',
      url: '/work-orders/WO-1006/close',
      payload: { requestedBy: 'restart-test' },
    });
    expect(response.statusCode).toBe(200);
    const eventId = response.json().data.eventId as string;
    await firstScheduler.dispatchPending();

    const beforeRestart = await pool.query(
      'SELECT 1 FROM notification_deliveries WHERE event_id = $1',
      [eventId],
    );
    expect(beforeRestart.rowCount).toBe(0);

    await firstApp.close();
    apps.splice(apps.indexOf(firstApp), 1);
    await firstScheduler.stop();
    schedulers.splice(schedulers.indexOf(firstScheduler), 1);

    await startScheduler(true);
    await waitFor(async () => {
      const delivered = await pool.query('SELECT 1 FROM notification_deliveries WHERE event_id = $1', [
        eventId,
      ]);
      return delivered.rowCount === 1;
    }, 'post-restart notification delivery');

    const persisted = await pool.query<{ status: string; event_count: string }>(
      `SELECT w.status,
         (SELECT count(*) FROM application_events e WHERE e.id = $2) AS event_count
       FROM work_orders w WHERE w.id = $1`,
      ['WO-1006', eventId],
    );
    expect(persisted.rows[0]).toEqual({ status: 'closed', event_count: '1' });
  });

  it('survives scheduler connection loss and recovers delivery in the same process', async () => {
    const scheduler = await startScheduler(true);
    const app = makeApp(scheduler);
    await pool.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE application_name = 'postgres-work-orders-scheduler'
         AND pid <> pg_backend_pid()`,
    );

    await waitFor(() => scheduler.isReady(), 'scheduler connection recovery');
    const response = await app.inject({
      method: 'POST',
      url: '/work-orders/WO-1006/close',
      payload: { requestedBy: 'connection-recovery-test' },
    });
    expect(response.statusCode).toBe(200);
    const eventId = response.json().data.eventId as string;
    await waitFor(async () => {
      const delivered = await pool.query(
        'SELECT 1 FROM notification_deliveries WHERE event_id = $1',
        [eventId],
      );
      return delivered.rowCount === 1;
    }, 'delivery after scheduler connection recovery');
  });
});
