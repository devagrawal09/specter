import { setTimeout as delay } from "node:timers/promises";
import type { Pool, RowDataPacket } from "mysql2/promise";

export const liveEnabled = process.env.RUN_LIVE_TESTS === "1";

export async function removeShipmentByReference(pool: Pool, reference: string): Promise<void> {
  const [rows] = await pool.query<(RowDataPacket & { id: string })[]>("SELECT id FROM shipments WHERE reference = ?", [reference]);
  for (const row of rows) {
    await pool.execute("DELETE FROM notifications WHERE shipment_id = ?", [row.id]);
    await pool.execute("DELETE FROM notification_outbox WHERE shipment_id = ?", [row.id]);
    await pool.execute("DELETE FROM shipment_history WHERE shipment_id = ?", [row.id]);
    await pool.execute("DELETE FROM shipments WHERE id = ?", [row.id]);
  }
}

export async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await probe();
    if (result !== undefined) return result;
    await delay(100);
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms`);
}
