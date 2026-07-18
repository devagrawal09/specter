import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

type MigrationStep = string | ((connection: PoolConnection) => Promise<void>);
type Migration = { id: string; statements: MigrationStep[] };

function addColumnIfMissing(table: string, column: string, definition: string): MigrationStep {
  return async (connection) => {
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
      [table, column]
    );
    if (rows.length === 0) await connection.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
}

const migrations: Migration[] = [
  {
    id: "001_initial_shipments",
    statements: [
      `CREATE TABLE IF NOT EXISTS shipments (
        id VARCHAR(64) PRIMARY KEY,
        reference VARCHAR(64) NOT NULL UNIQUE,
        recipient_name VARCHAR(160) NOT NULL,
        status VARCHAR(24) NOT NULL,
        payment_captured BOOLEAN NOT NULL DEFAULT FALSE,
        inventory_allocated BOOLEAN NOT NULL DEFAULT FALSE,
        dispatched_at DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        INDEX idx_shipments_status (status)
      ) ENGINE=InnoDB`,
      `CREATE TABLE IF NOT EXISTS shipment_history (
        id VARCHAR(96) PRIMARY KEY,
        shipment_id VARCHAR(64) NOT NULL,
        event_key VARCHAR(128) NOT NULL UNIQUE,
        event_type VARCHAR(48) NOT NULL,
        from_status VARCHAR(24) NULL,
        to_status VARCHAR(24) NOT NULL,
        metadata JSON NOT NULL,
        occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX idx_history_shipment_time (shipment_id, occurred_at),
        CONSTRAINT fk_history_shipment FOREIGN KEY (shipment_id) REFERENCES shipments(id)
      ) ENGINE=InnoDB`,
      `CREATE TABLE IF NOT EXISTS notification_outbox (
        id VARCHAR(96) PRIMARY KEY,
        shipment_id VARCHAR(64) NOT NULL,
        event_key VARCHAR(128) NOT NULL UNIQUE,
        job_id VARCHAR(128) NOT NULL UNIQUE,
        payload JSON NOT NULL,
        status VARCHAR(24) NOT NULL DEFAULT 'pending',
        attempts INT UNSIGNED NOT NULL DEFAULT 0,
        delivery_attempts INT UNSIGNED NOT NULL DEFAULT 0,
        retry_generation INT UNSIGNED NOT NULL DEFAULT 0,
        dead_letter_count INT UNSIGNED NOT NULL DEFAULT 0,
        last_failed_job_id VARCHAR(128) NULL,
        last_error VARCHAR(500) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        enqueued_at DATETIME(3) NULL,
        completed_at DATETIME(3) NULL,
        dead_lettered_at DATETIME(3) NULL,
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        INDEX idx_outbox_status_created (status, created_at),
        CONSTRAINT fk_outbox_shipment FOREIGN KEY (shipment_id) REFERENCES shipments(id)
      ) ENGINE=InnoDB`,
      `CREATE TABLE IF NOT EXISTS notifications (
        id VARCHAR(96) PRIMARY KEY,
        outbox_id VARCHAR(96) NOT NULL UNIQUE,
        shipment_id VARCHAR(64) NOT NULL,
        kind VARCHAR(48) NOT NULL,
        payload JSON NOT NULL,
        delivered_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        CONSTRAINT fk_notifications_outbox FOREIGN KEY (outbox_id) REFERENCES notification_outbox(id),
        CONSTRAINT fk_notifications_shipment FOREIGN KEY (shipment_id) REFERENCES shipments(id)
      ) ENGINE=InnoDB`
    ]
  },
  {
    id: "002_notification_dead_letters",
    statements: [
      addColumnIfMissing("notification_outbox", "delivery_attempts", "INT UNSIGNED NOT NULL DEFAULT 0 AFTER attempts"),
      addColumnIfMissing("notification_outbox", "retry_generation", "INT UNSIGNED NOT NULL DEFAULT 0 AFTER delivery_attempts"),
      addColumnIfMissing("notification_outbox", "dead_letter_count", "INT UNSIGNED NOT NULL DEFAULT 0 AFTER retry_generation"),
      addColumnIfMissing("notification_outbox", "last_failed_job_id", "VARCHAR(128) NULL AFTER dead_letter_count"),
      addColumnIfMissing("notification_outbox", "dead_lettered_at", "DATETIME(3) NULL AFTER completed_at")
    ]
  }
];

export async function runMigrations(pool: Pool): Promise<string[]> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id VARCHAR(128) PRIMARY KEY,
    applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB`);
  const connection = await pool.getConnection();
  let locked = false;
  try {
    const [lockRows] = await connection.query<RowDataPacket[]>("SELECT GET_LOCK('mysql_shipments_migrations', 10) AS acquired");
    locked = Number(lockRows[0]?.acquired) === 1;
    if (!locked) throw new Error("Could not acquire migration lock within 10 seconds");
    const applied: string[] = [];
    for (const migration of migrations) {
      const [rows] = await connection.query<RowDataPacket[]>("SELECT id FROM schema_migrations WHERE id = ?", [migration.id]);
      if (rows.length > 0) continue;
      // MySQL DDL auto-commits. Every step is convergent (IF NOT EXISTS or an
      // information_schema guard), so a partial failure resumes safely; the marker
      // is written only after every DDL step succeeds.
      for (const statement of migration.statements) {
        if (typeof statement === "string") await connection.query(statement);
        else await statement(connection);
      }
      await connection.query("INSERT INTO schema_migrations (id) VALUES (?) ON DUPLICATE KEY UPDATE id = VALUES(id)", [migration.id]);
      applied.push(migration.id);
    }
    return applied;
  } finally {
    if (locked) await connection.query("SELECT RELEASE_LOCK('mysql_shipments_migrations')");
    connection.release();
  }
}
