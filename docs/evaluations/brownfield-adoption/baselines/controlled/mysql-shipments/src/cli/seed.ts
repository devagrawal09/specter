import { loadConfig } from "../config.js";
import { createPool } from "../db.js";
import { runMigrations } from "../migrations.js";
import { closeQueueResources, countReconciliableOutbox, createQueueResources, pingRedis, reconcileOutbox } from "../queue.js";
import { legacySnapshotIds, seedLegacyData } from "../seed.js";

const config = loadConfig();
const pool = createPool(config);
try {
  await runMigrations(pool);
  await seedLegacyData(pool);
  let reconciliation: { examined: number; enqueued: number; deadLettered: number; failed: number };
  try {
    await pingRedis(config);
    const queue = createQueueResources(config);
    try {
      reconciliation = await reconcileOutbox(pool, queue.queue, config.reconcileBatchSize);
    } finally {
      await closeQueueResources(queue);
    }
  } catch {
    const pending = await countReconciliableOutbox(pool);
    reconciliation = { examined: pending, enqueued: 0, deadLettered: 0, failed: pending };
  }
  console.log(JSON.stringify({ ok: true, snapshotIds: legacySnapshotIds, reconciliation }));
} finally {
  await pool.end();
}
