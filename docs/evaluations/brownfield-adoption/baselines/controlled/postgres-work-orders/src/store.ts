import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { DomainError } from './domain/errors';
import { decideClose, type WorkOrder, type WorkOrderStatus } from './domain/work-order';

export interface HistoryEntry {
  id: number;
  action: string;
  fromStatus: WorkOrderStatus | null;
  toStatus: WorkOrderStatus | null;
  details: unknown;
  createdAt: string;
}

export interface EventResult {
  eventId: string;
  workOrder: WorkOrder;
}

export interface WorkOrderStore {
  list(): Promise<WorkOrder[]>;
  get(id: string): Promise<WorkOrder | null>;
  create(input: { id: string; title: string }): Promise<WorkOrder>;
  setInspection(id: string, passed: boolean): Promise<WorkOrder>;
  history(id: string): Promise<HistoryEntry[] | null>;
  requestReminder(id: string): Promise<EventResult>;
  close(id: string, requestedBy: string): Promise<EventResult>;
}

interface WorkOrderRow {
  id: string;
  title: string;
  status: WorkOrderStatus;
  inspection_passed: boolean;
  closed_at: Date | string | null;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapWorkOrder(row: WorkOrderRow): WorkOrder {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    inspectionPassed: row.inspection_passed,
    closedAt: row.closed_at === null ? null : iso(row.closed_at),
    version: row.version,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function inTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export class PostgresWorkOrderStore implements WorkOrderStore {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<WorkOrder[]> {
    const result = await this.pool.query<WorkOrderRow>(
      `SELECT id, title, status, inspection_passed, closed_at, version, created_at, updated_at
       FROM work_orders
       ORDER BY id`,
    );
    return result.rows.map(mapWorkOrder);
  }

  async get(id: string): Promise<WorkOrder | null> {
    const result = await this.pool.query<WorkOrderRow>(
      `SELECT id, title, status, inspection_passed, closed_at, version, created_at, updated_at
       FROM work_orders
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] === undefined ? null : mapWorkOrder(result.rows[0]);
  }

  async create(input: { id: string; title: string }): Promise<WorkOrder> {
    try {
      return await inTransaction(this.pool, async (client) => {
        const inserted = await client.query<WorkOrderRow>(
          `INSERT INTO work_orders (id, title, status, inspection_passed)
           VALUES ($1, $2, 'open', false)
           RETURNING id, title, status, inspection_passed, closed_at, version, created_at, updated_at`,
          [input.id, input.title],
        );
        await client.query(
          `INSERT INTO work_order_history
             (work_order_id, action, from_status, to_status, details)
           VALUES ($1, 'created', NULL, 'open', '{}'::jsonb)`,
          [input.id],
        );
        return mapWorkOrder(inserted.rows[0]!);
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        throw new DomainError(409, 'WORK_ORDER_EXISTS', `Work order ${input.id} already exists`);
      }
      throw error;
    }
  }

  async setInspection(id: string, passed: boolean): Promise<WorkOrder> {
    return inTransaction(this.pool, async (client) => {
      const current = await client.query<WorkOrderRow>(
        `SELECT id, title, status, inspection_passed, closed_at, version, created_at, updated_at
         FROM work_orders WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const row = current.rows[0];
      if (row === undefined) {
        throw new DomainError(404, 'WORK_ORDER_NOT_FOUND', `Work order ${id} was not found`);
      }

      const updated = await client.query<WorkOrderRow>(
        `UPDATE work_orders
         SET inspection_passed = $2, updated_at = now(), version = version + 1
         WHERE id = $1
         RETURNING id, title, status, inspection_passed, closed_at, version, created_at, updated_at`,
        [id, passed],
      );
      await client.query(
        `INSERT INTO work_order_history
           (work_order_id, action, from_status, to_status, details)
         VALUES ($1, 'inspection_updated', $2, $2, jsonb_build_object('passed', $3::boolean))`,
        [id, row.status, passed],
      );
      return mapWorkOrder(updated.rows[0]!);
    });
  }

  async history(id: string): Promise<HistoryEntry[] | null> {
    if ((await this.get(id)) === null) return null;
    const result = await this.pool.query<{
      id: string;
      action: string;
      from_status: WorkOrderStatus | null;
      to_status: WorkOrderStatus | null;
      details: unknown;
      created_at: Date | string;
    }>(
      `SELECT id, action, from_status, to_status, details, created_at
       FROM work_order_history
       WHERE work_order_id = $1
       ORDER BY created_at, id`,
      [id],
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      action: row.action,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      details: row.details,
      createdAt: iso(row.created_at),
    }));
  }

  async requestReminder(id: string): Promise<EventResult> {
    return inTransaction(this.pool, async (client) => {
      const current = await client.query<WorkOrderRow>(
        `SELECT id, title, status, inspection_passed, closed_at, version, created_at, updated_at
         FROM work_orders WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const row = current.rows[0];
      if (row === undefined) {
        throw new DomainError(404, 'WORK_ORDER_NOT_FOUND', `Work order ${id} was not found`);
      }
      const eventId = randomUUID();
      await client.query(
        `INSERT INTO application_events
           (id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, 'work_order', $2, 'WorkOrderReminderRequested',
           jsonb_build_object('workOrderId', $2::text, 'status', $3::text))`,
        [eventId, id, row.status],
      );
      await client.query(
        `INSERT INTO work_order_history
           (work_order_id, action, from_status, to_status, details)
         VALUES ($1, 'reminder_requested', $2, $2, jsonb_build_object('eventId', $3::text))`,
        [id, row.status, eventId],
      );
      return { eventId, workOrder: mapWorkOrder(row) };
    });
  }

  async close(id: string, requestedBy: string): Promise<EventResult> {
    return inTransaction(this.pool, async (client) => {
      const current = await client.query<WorkOrderRow>(
        `SELECT id, title, status, inspection_passed, closed_at, version, created_at, updated_at
         FROM work_orders WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const row = current.rows[0];
      if (row === undefined) {
        throw new DomainError(404, 'WORK_ORDER_NOT_FOUND', `Work order ${id} was not found`);
      }

      const decision = decideClose(row.status, row.inspection_passed);
      if (!decision.accepted) {
        throw new DomainError(409, decision.code, decision.message, {
          status: row.status,
          inspectionPassed: row.inspection_passed,
        });
      }

      const updated = await client.query<WorkOrderRow>(
        `UPDATE work_orders
         SET status = 'closed', closed_at = now(), updated_at = now(), version = version + 1
         WHERE id = $1
         RETURNING id, title, status, inspection_passed, closed_at, version, created_at, updated_at`,
        [id],
      );
      const workOrder = mapWorkOrder(updated.rows[0]!);
      const eventId = randomUUID();
      await client.query(
        `INSERT INTO work_order_history
           (work_order_id, action, from_status, to_status, details)
         VALUES ($1, 'closed', $2, 'closed',
           jsonb_build_object('eventId', $3::text, 'requestedBy', $4::text))`,
        [id, row.status, eventId, requestedBy],
      );
      await client.query(
        `INSERT INTO application_events
           (id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, 'work_order', $2, 'WorkOrderClosed',
           jsonb_build_object(
             'workOrderId', $2::text,
             'previousStatus', $3::text,
             'closedAt', $4::text,
             'requestedBy', $5::text
           ))`,
        [eventId, id, row.status, workOrder.closedAt, requestedBy],
      );
      return { eventId, workOrder };
    });
  }
}
