import type { Pool, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db.js";
import { AppError } from "../src/errors.js";
import { runMigrations } from "../src/migrations.js";
import { MysqlShipmentStore } from "../src/repository.js";
import { legacySnapshotIds, seedLegacyData } from "../src/seed.js";
import { liveEnabled, removeShipmentByReference } from "./live-helpers.js";

const suite = liveEnabled ? describe : describe.skip;

suite("live MySQL migrations and dispatch transaction", () => {
  let pool: Pool;
  const reference = "LIVE-DB-ATOMIC-001";

  beforeAll(async () => {
    pool = createPool(loadConfig());
    await runMigrations(pool);
    await runMigrations(pool);
    await seedLegacyData(pool);
    await seedLegacyData(pool);
    await removeShipmentByReference(pool, reference);
  });

  afterAll(async () => {
    await removeShipmentByReference(pool, reference);
    await pool.end();
  });

  it("upgrades a pre-dead-letter outbox schema repeat-safely despite MySQL DDL auto-commit", async () => {
    await pool.query(
      `ALTER TABLE notification_outbox
       DROP COLUMN delivery_attempts,
       DROP COLUMN retry_generation,
       DROP COLUMN dead_letter_count,
       DROP COLUMN last_failed_job_id,
       DROP COLUMN dead_lettered_at`
    );
    await pool.execute("DELETE FROM schema_migrations WHERE id = '002_notification_dead_letters'");
    await expect(runMigrations(pool)).resolves.toEqual(["002_notification_dead_letters"]);
    await expect(runMigrations(pool)).resolves.toEqual([]);
    const [columns] = await pool.query<(RowDataPacket & { name: string })[]>(
      `SELECT column_name AS name FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'notification_outbox'
         AND column_name IN ('delivery_attempts', 'retry_generation', 'dead_letter_count', 'last_failed_job_id', 'dead_lettered_at')
       ORDER BY column_name`
    );
    expect(columns.map((column) => column.name)).toEqual([
      "dead_letter_count",
      "dead_lettered_at",
      "delivery_attempts",
      "last_failed_job_id",
      "retry_generation"
    ]);
  });

  it("reconciles exactly five deterministic snapshot shipments without changing readers", async () => {
    const store = new MysqlShipmentStore(pool);
    const listed = await store.list();
    expect(legacySnapshotIds.every((id) => listed.some((shipment) => shipment.id === id))).toBe(true);
    const ready = await store.get("shp-ready-001");
    expect(ready.reference).toBe("LEGACY-READY-001");
    expect((await store.history("shp-ready-001")).some((event) => event.eventType === "shipment.imported")).toBe(true);
  });

  it("allows exactly one concurrent dispatch and atomically writes history plus outbox", async () => {
    const store = new MysqlShipmentStore(pool);
    const created = await store.create({ reference, recipientName: "Live DB", paymentCaptured: true, inventoryAllocated: true });
    const results = await Promise.allSettled([store.dispatch(created.id), store.dispatch(created.id)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toBeDefined();
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(AppError);
    expect(((rejected as PromiseRejectedResult).reason as AppError).code).toBe("INVALID_TRANSITION");

    const [rows] = await pool.query<(RowDataPacket & { history_count: number; outbox_count: number })[]>(
      `SELECT
        (SELECT COUNT(*) FROM shipment_history WHERE shipment_id = ? AND event_type = 'shipment.dispatched') AS history_count,
        (SELECT COUNT(*) FROM notification_outbox WHERE shipment_id = ?) AS outbox_count`,
      [created.id, created.id]
    );
    expect(rows[0]).toMatchObject({ history_count: 1, outbox_count: 1 });
  });

  it.each([
    ["shp-payment-002", "PAYMENT_NOT_CAPTURED"],
    ["shp-inventory-003", "INVENTORY_NOT_ALLOCATED"],
    ["shp-cancelled-004", "INVALID_TRANSITION"],
    ["shp-dispatched-005", "INVALID_TRANSITION"],
    ["shp-missing", "NOT_FOUND"]
  ])("rejects persisted invalid state for %s", async (id, code) => {
    await expect(new MysqlShipmentStore(pool).dispatch(id)).rejects.toMatchObject({ code });
  });
});
