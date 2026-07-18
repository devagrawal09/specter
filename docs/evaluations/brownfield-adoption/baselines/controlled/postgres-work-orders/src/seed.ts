import { PgBoss } from 'pg-boss';
import type { Pool, PoolClient } from 'pg';
import { WORK_ORDER_JOB } from './scheduler';
import type { WorkOrderStatus } from './domain/work-order';

interface Fixture {
  id: string;
  title: string;
  status: WorkOrderStatus;
  inspectionPassed: boolean;
  closedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export const LEGACY_FIXTURES: readonly Fixture[] = [
  {
    id: 'WO-1001',
    title: 'Hydraulic pump overhaul',
    status: 'in_progress',
    inspectionPassed: true,
    closedAt: null,
    version: 3,
    createdAt: '2025-01-02T09:00:00.000Z',
    updatedAt: '2025-01-08T15:30:00.000Z',
  },
  {
    id: 'WO-1002',
    title: 'Loading dock light replacement',
    status: 'open',
    inspectionPassed: true,
    closedAt: null,
    version: 1,
    createdAt: '2025-01-03T10:00:00.000Z',
    updatedAt: '2025-01-03T10:00:00.000Z',
  },
  {
    id: 'WO-1003',
    title: 'Conveyor guard alignment',
    status: 'in_progress',
    inspectionPassed: false,
    closedAt: null,
    version: 4,
    createdAt: '2025-01-04T11:00:00.000Z',
    updatedAt: '2025-01-09T12:00:00.000Z',
  },
  {
    id: 'WO-1004',
    title: 'Boiler pressure calibration',
    status: 'closed',
    inspectionPassed: true,
    closedAt: '2025-01-08T17:00:00.000Z',
    version: 7,
    createdAt: '2025-01-01T08:00:00.000Z',
    updatedAt: '2025-01-08T17:00:00.000Z',
  },
  {
    id: 'WO-1005',
    title: 'Retired compressor inspection',
    status: 'cancelled',
    inspectionPassed: true,
    closedAt: null,
    version: 2,
    createdAt: '2025-01-05T13:00:00.000Z',
    updatedAt: '2025-01-06T09:00:00.000Z',
  },
  {
    id: 'WO-1006',
    title: 'Emergency generator service',
    status: 'in_progress',
    inspectionPassed: true,
    closedAt: null,
    version: 5,
    createdAt: '2025-01-06T14:00:00.000Z',
    updatedAt: '2025-01-10T16:00:00.000Z',
  },
];

async function deleteSchedulerRows(client: PoolClient, ids: string[]): Promise<void> {
  for (const table of ['job', 'archive'] as const) {
    const relation = await client.query<{ relation: string | null }>(
      `SELECT to_regclass($1) AS relation`,
      [`pgboss.${table}`],
    );
    if (relation.rows[0]?.relation === null) continue;
    const dataColumn = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'pgboss' AND table_name = $1 AND column_name = 'data'`,
      [table],
    );
    if (dataColumn.rowCount === 0) continue;
    await client.query(
      `DELETE FROM pgboss.${table}
       WHERE data ->> 'workOrderId' = ANY($1::text[])
          OR data ->> 'aggregateId' = ANY($1::text[])`,
      [ids],
    );
  }
}

export async function seed(pool: Pool, connectionString: string): Promise<void> {
  const boss = new PgBoss({ connectionString });
  await boss.start();
  try {
    await boss.createQueue(WORK_ORDER_JOB);
  } finally {
    await boss.stop({ graceful: true, timeout: 5_000 });
  }

  const ids = LEGACY_FIXTURES.map((fixture) => fixture.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await deleteSchedulerRows(client, ids);
    await client.query('DELETE FROM application_events WHERE aggregate_id = ANY($1::text[])', [ids]);
    await client.query('DELETE FROM work_order_history WHERE work_order_id = ANY($1::text[])', [ids]);

    for (const fixture of LEGACY_FIXTURES) {
      await client.query(
        `INSERT INTO work_orders
           (id, title, status, inspection_passed, closed_at, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           status = EXCLUDED.status,
           inspection_passed = EXCLUDED.inspection_passed,
           closed_at = EXCLUDED.closed_at,
           version = EXCLUDED.version,
           created_at = EXCLUDED.created_at,
           updated_at = EXCLUDED.updated_at`,
        [
          fixture.id,
          fixture.title,
          fixture.status,
          fixture.inspectionPassed,
          fixture.closedAt,
          fixture.version,
          fixture.createdAt,
          fixture.updatedAt,
        ],
      );
      await client.query(
        `INSERT INTO work_order_history
           (work_order_id, action, from_status, to_status, details, created_at)
         VALUES ($1, 'seed_snapshot', NULL, $2,
           jsonb_build_object('snapshot', 'legacy-v1'), $3)`,
        [fixture.id, fixture.status, fixture.updatedAt],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
