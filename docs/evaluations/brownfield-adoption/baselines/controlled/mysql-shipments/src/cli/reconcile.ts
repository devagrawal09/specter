import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "../config.js";
import { createPool } from "../db.js";
import { closeQueueResources, countReconciliableOutbox, createQueueResources, pingRedis, reconcileOutbox } from "../queue.js";

const config = loadConfig();
const pool = createPool(config);
const loop = process.argv.includes("--loop");
let stopping = false;

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

try {
  do {
    try {
      // Probe with a one-shot raw Redis connection. Do not construct BullMQ's
      // internal connection wrapper until Redis is reachable: tearing down a
      // failed wrapper can emit an uncaught late error in BullMQ.
      await pingRedis(config);
      const queue = createQueueResources(config);
      try {
        const result = await reconcileOutbox(pool, queue.queue, config.reconcileBatchSize);
        console.log(JSON.stringify({ event: "outbox-reconciled", ...result }));
      } finally {
        await closeQueueResources(queue);
      }
    } catch {
      const pending = await countReconciliableOutbox(pool);
      console.log(JSON.stringify({ event: "outbox-reconciled", examined: pending, enqueued: 0, failed: pending, redis: "unavailable" }));
    }
    if (!loop || stopping) break;
    await delay(config.reconcileIntervalMs);
  } while (!stopping);
} finally {
  await pool.end();
}
