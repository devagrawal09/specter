import { PgBoss } from 'pg-boss';
import type { Pool } from 'pg';

export const WORK_ORDER_JOB = 'work-order-events';

interface WorkOrderJobData {
  eventId: string;
  workOrderId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

interface SchedulerOptions {
  connectionString: string;
  pool: Pool;
  runWorker: boolean;
  dispatchIntervalMs: number;
}

export class WorkOrderScheduler {
  private readonly boss: PgBoss;
  private timer: NodeJS.Timeout | undefined;
  private dispatching: Promise<number> | undefined;
  private started = false;
  private healthy = false;

  constructor(private readonly options: SchedulerOptions) {
    this.boss = new PgBoss({
      connectionString: options.connectionString,
      connectionTimeoutMillis: 1_000,
      application_name: 'postgres-work-orders-scheduler',
    });
    // pg-boss promotes pool failures as EventEmitter errors. A database outage is an
    // expected degraded state, not a reason for Node to terminate.
    this.boss.on('error', () => {
      this.healthy = false;
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.boss.start();
    this.started = true;
    await this.boss.createQueue(WORK_ORDER_JOB);
    this.healthy = true;

    if (this.options.runWorker) {
      await this.boss.work<WorkOrderJobData>(WORK_ORDER_JOB, async (jobs) => {
        for (const job of jobs) {
          const data = job.data;
          await this.options.pool.query(
            `INSERT INTO notification_deliveries
               (event_id, work_order_id, kind, payload)
             VALUES ($1, $2, $3, $4::jsonb)
             ON CONFLICT (event_id) DO NOTHING`,
            [data.eventId, data.workOrderId, data.eventType, JSON.stringify(data.payload)],
          );
        }
      });
    }

    await this.dispatchPending();
    this.timer = setInterval(() => {
      void this.dispatchPending().catch(() => undefined);
    }, this.options.dispatchIntervalMs);
    this.timer.unref();
  }

  async dispatchPending(): Promise<number> {
    if (!this.started) return 0;
    if (this.dispatching !== undefined) return this.dispatching;

    this.dispatching = this.doDispatch().finally(() => {
      this.dispatching = undefined;
    });
    return this.dispatching;
  }

  async isReady(): Promise<boolean> {
    if (!this.started) return false;
    try {
      const queue = await this.boss.getQueue(WORK_ORDER_JOB);
      this.healthy = queue !== null;
    } catch {
      this.healthy = false;
    }
    return this.healthy;
  }

  private async doDispatch(): Promise<number> {
    try {
      const result = await this.options.pool.query<{
        id: string;
        aggregate_id: string;
        event_type: string;
        payload: Record<string, unknown>;
      }>(
        `SELECT id, aggregate_id, event_type, payload
         FROM application_events
         WHERE enqueued_at IS NULL
         ORDER BY created_at, id
         LIMIT 25`,
      );

      for (const event of result.rows) {
        await this.boss.send(
          WORK_ORDER_JOB,
          {
            eventId: event.id,
            workOrderId: event.aggregate_id,
            eventType: event.event_type,
            payload: event.payload,
          },
          { singletonKey: `application-event:${event.id}`, retryLimit: 5, retryDelay: 2 },
        );
        await this.options.pool.query(
          `UPDATE application_events SET enqueued_at = now()
           WHERE id = $1 AND enqueued_at IS NULL`,
          [event.id],
        );
      }
      this.healthy = true;
      return result.rowCount ?? 0;
    } catch (error) {
      this.healthy = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    if (this.timer !== undefined) clearInterval(this.timer);
    try {
      await this.dispatching;
    } finally {
      try {
        await this.boss.stop({ graceful: true, timeout: 5_000 });
      } finally {
        this.started = false;
        this.healthy = false;
      }
    }
  }
}
