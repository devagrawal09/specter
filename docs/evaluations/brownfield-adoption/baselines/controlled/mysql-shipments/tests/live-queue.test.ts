import type { Pool, RowDataPacket } from "mysql2/promise";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type AppConfig } from "../src/config.js";
import { createPool } from "../src/db.js";
import { runMigrations } from "../src/migrations.js";
import {
  closeQueueResources,
  createNotificationWorker,
  createQueueResources,
  NOTIFICATION_JOB_ATTEMPTS,
  reconcileOutbox
} from "../src/queue.js";
import { MysqlShipmentStore } from "../src/repository.js";
import { DefaultShipmentService } from "../src/service.js";
import { liveEnabled, removeShipmentByReference, waitFor } from "./live-helpers.js";

const suite = liveEnabled ? describe : describe.skip;

suite("live queue, outage recovery, reconciliation, and restart durability", () => {
  let pool: Pool;
  let config: AppConfig;
  const references = ["LIVE-QUEUE-001", "LIVE-OUTAGE-002", "LIVE-DEAD-LETTER-003"];

  beforeAll(async () => {
    config = loadConfig();
    pool = createPool(config);
    await runMigrations(pool);
    const queue = createQueueResources(config);
    await queue.queue.obliterate({ force: true });
    await closeQueueResources(queue);
    for (const reference of references) await removeShipmentByReference(pool, reference);
  });

  afterAll(async () => {
    for (const reference of references) await removeShipmentByReference(pool, reference);
    await pool.end();
  });

  it("closes an unused producer queue without a late RedisConnection error", async () => {
    const queue = createQueueResources(config);
    await closeQueueResources(queue);
    // Give a late connection event time to surface as a Vitest unhandled error.
    await delay(100);
  });

  it("executes durable notification work exactly once", async () => {
    const queue = createQueueResources(config);
    const worker = createNotificationWorker(config, pool);
    try {
      await worker.worker.waitUntilReady();
      const store = new MysqlShipmentStore(pool);
      const created = await store.create({ reference: references[0]!, recipientName: "Queue Test", paymentCaptured: true, inventoryAllocated: true });
      const response = await new DefaultShipmentService(store, pool, queue.queue).dispatch(created.id);
      expect(response.notification.delivery).toBe("enqueued");
      await waitFor(async () => {
        const [rows] = await pool.query<(RowDataPacket & { status: string; notification_count: number })[]>(
          `SELECT o.status, (SELECT COUNT(*) FROM notifications n WHERE n.outbox_id = o.id) AS notification_count
           FROM notification_outbox o WHERE o.id = ?`,
          [response.notification.id]
        );
        return rows[0]?.status === "completed" ? rows[0] : undefined;
      });
      const [rows] = await pool.query<(RowDataPacket & { count: number })[]>("SELECT COUNT(*) AS count FROM notifications WHERE shipment_id = ?", [created.id]);
      expect(rows[0]?.count).toBe(1);
    } finally {
      await worker.worker.close();
      worker.redis.disconnect();
      await closeQueueResources(queue);
    }
  });

  it("bounds Redis failure, persists the outbox, then recovers after fresh-process reconciliation", async () => {
    const outageConfig: AppConfig = { ...config, redisUrl: "redis://127.0.0.1:42999", redisCommandTimeoutMs: 200 };
    const unavailableQueue = createQueueResources(outageConfig);
    const store = new MysqlShipmentStore(pool);
    const created = await store.create({ reference: references[1]!, recipientName: "Outage Test", paymentCaptured: true, inventoryAllocated: true });
    const started = Date.now();
    const response = await new DefaultShipmentService(store, pool, unavailableQueue.queue).dispatch(created.id);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(2000);
    expect(response.notification.delivery).toBe("pending");
    await closeQueueResources(unavailableQueue);

    const [pending] = await pool.query<(RowDataPacket & { status: string })[]>("SELECT status FROM notification_outbox WHERE id = ?", [response.notification.id]);
    expect(pending[0]?.status).toBe("pending");

    // Close and recreate the DB pool to model a fresh app/reconciler process.
    await pool.end();
    pool = createPool(config);
    const recoveredQueue = createQueueResources(config);
    const worker = createNotificationWorker(config, pool);
    try {
      await worker.worker.waitUntilReady();
      const first = await reconcileOutbox(pool, recoveredQueue.queue, 50);
      const second = await reconcileOutbox(pool, recoveredQueue.queue, 50);
      expect(first.failed).toBe(0);
      expect(second.failed).toBe(0);
      await waitFor(async () => {
        const [rows] = await pool.query<(RowDataPacket & { status: string; count: number })[]>(
          `SELECT o.status, (SELECT COUNT(*) FROM notifications n WHERE n.outbox_id = o.id) AS count
           FROM notification_outbox o WHERE o.id = ?`,
          [response.notification.id]
        );
        return rows[0]?.status === "completed" ? rows[0] : undefined;
      });
      const [delivered] = await pool.query<(RowDataPacket & { count: number })[]>("SELECT COUNT(*) AS count FROM notifications WHERE shipment_id = ?", [created.id]);
      expect(delivered[0]?.count).toBe(1);
    } finally {
      await worker.worker.close();
      worker.redis.disconnect();
      await closeQueueResources(recoveredQueue);
    }
  });

  it("recovers an actually exhausted final attempt through durable dead-letter state and a new job generation", async () => {
    const queue = createQueueResources(config);
    const store = new MysqlShipmentStore(pool);
    const created = await store.create({ reference: references[2]!, recipientName: "Dead Letter Test", paymentCaptured: true, inventoryAllocated: true });
    const response = await new DefaultShipmentService(store, pool, queue.queue).dispatch(created.id);
    expect(response.notification.delivery).toBe("enqueued");

    const unavailablePool = createPool({ mysqlUrl: "mysql://shipments:shipments@127.0.0.1:42998/shipments" });
    const failingWorker = createNotificationWorker(config, unavailablePool);
    try {
      await failingWorker.worker.waitUntilReady();
      const failedJob = await waitFor(async () => {
        const job = await queue.queue.getJob(response.notification.jobId);
        return job && await job.getState() === "failed" ? job : undefined;
      });
      expect(failedJob.attemptsMade).toBe(NOTIFICATION_JOB_ATTEMPTS);
      expect(failedJob.failedReason).toContain("ECONNREFUSED");
    } finally {
      await failingWorker.worker.close();
      failingWorker.redis.disconnect();
      await unavailablePool.end();
    }

    const [stranded] = await pool.query<(RowDataPacket & { status: string; job_id: string })[]>(
      "SELECT status, job_id FROM notification_outbox WHERE id = ?",
      [response.notification.id]
    );
    expect(stranded[0]).toMatchObject({ status: "enqueued", job_id: response.notification.jobId });

    const firstPass = await reconcileOutbox(pool, queue.queue, 50);
    expect(firstPass.deadLettered).toBeGreaterThanOrEqual(1);
    const [deadLetter] = await pool.query<(RowDataPacket & {
      status: string;
      delivery_attempts: number;
      retry_generation: number;
      dead_letter_count: number;
      last_failed_job_id: string;
    })[]>(
      `SELECT status, delivery_attempts, retry_generation, dead_letter_count, last_failed_job_id
       FROM notification_outbox WHERE id = ?`,
      [response.notification.id]
    );
    expect(deadLetter[0]).toEqual({
      status: "dead_letter",
      delivery_attempts: NOTIFICATION_JOB_ATTEMPTS,
      retry_generation: 0,
      dead_letter_count: 1,
      last_failed_job_id: response.notification.jobId
    });

    const healthyWorker = createNotificationWorker(config, pool);
    try {
      await healthyWorker.worker.waitUntilReady();
      const secondPass = await reconcileOutbox(pool, queue.queue, 50);
      expect(secondPass.enqueued).toBeGreaterThanOrEqual(1);
      const retryJobId = `${response.notification.jobId}-r1`;
      const [retried] = await pool.query<(RowDataPacket & { status: string; job_id: string; retry_generation: number })[]>(
        "SELECT status, job_id, retry_generation FROM notification_outbox WHERE id = ?",
        [response.notification.id]
      );
      expect(retried[0]).toMatchObject({ job_id: retryJobId, retry_generation: 1 });
      await waitFor(async () => {
        const [rows] = await pool.query<(RowDataPacket & { status: string; count: number })[]>(
          `SELECT o.status, (SELECT COUNT(*) FROM notifications n WHERE n.outbox_id = o.id) AS count
           FROM notification_outbox o WHERE o.id = ?`,
          [response.notification.id]
        );
        return rows[0]?.status === "completed" ? rows[0] : undefined;
      });
      const retryJob = await queue.queue.getJob(retryJobId);
      expect(await retryJob?.getState()).toBe("completed");
      const [delivered] = await pool.query<(RowDataPacket & { count: number })[]>(
        "SELECT COUNT(*) AS count FROM notifications WHERE shipment_id = ?",
        [created.id]
      );
      expect(delivered[0]?.count).toBe(1);
    } finally {
      await healthyWorker.worker.close();
      healthyWorker.redis.disconnect();
      await closeQueueResources(queue);
    }
  });
});
