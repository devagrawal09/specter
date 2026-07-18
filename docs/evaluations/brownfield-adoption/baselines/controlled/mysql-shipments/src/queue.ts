import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import type { Pool, RowDataPacket } from "mysql2/promise";
import type { AppConfig } from "./config.js";
import { inTransaction } from "./db.js";

export const NOTIFICATION_QUEUE = "shipment-notifications-v1";

type OutboxRow = RowDataPacket & {
  id: string;
  shipment_id: string;
  event_key: string;
  job_id: string;
  payload: string | Record<string, unknown>;
  status: "pending" | "enqueued" | "completed" | "dead_letter";
  delivery_attempts: number;
  retry_generation: number;
  dead_letter_count: number;
};

export const NOTIFICATION_JOB_ATTEMPTS = 4;

export function notificationJobId(shipmentId: string, retryGeneration = 0): string {
  const base = `notify-dispatch-${shipmentId}`;
  return retryGeneration === 0 ? base : `${base}-r${retryGeneration}`;
}

export type QueueResources = { redis: Redis; queue: Queue };

function producerRedis(config: AppConfig): Redis {
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: config.redisCommandTimeoutMs,
    commandTimeout: config.redisCommandTimeoutMs,
    retryStrategy: () => null
  });
  redis.on("error", () => undefined);
  return redis;
}

export function createQueueResources(config: AppConfig): QueueResources {
  const redis = producerRedis(config);
  const queue = new Queue(NOTIFICATION_QUEUE, { connection: redis, defaultJobOptions: { removeOnComplete: false, removeOnFail: false } });
  // BullMQ re-emits connection failures. A listener is mandatory because an
  // expected outage must not become an uncaught EventEmitter error.
  queue.on("error", () => undefined);
  return { redis, queue };
}

export async function closeQueueResources(resources: QueueResources): Promise<void> {
  // A producer Queue starts its internal RedisConnection asynchronously. Closing an
  // otherwise-unused queue before that connection settles can leave a late unhandled
  // RedisConnection error. Outage configurations reject within their connect deadline.
  await resources.queue.waitUntilReady().catch(() => undefined);
  await resources.queue.close().catch(() => undefined);
  resources.redis.disconnect();
}

async function outboxRow(pool: Pool, id: string): Promise<OutboxRow | undefined> {
  const [rows] = await pool.query<OutboxRow[]>("SELECT * FROM notification_outbox WHERE id = ?", [id]);
  return rows[0];
}

export async function markOutboxDeadLetter(
  pool: Pool,
  id: string,
  jobId: string,
  deliveryAttempts: number,
  reason: string
): Promise<void> {
  await pool.execute(
    `UPDATE notification_outbox
     SET status = 'dead_letter',
         delivery_attempts = GREATEST(delivery_attempts, ?),
         dead_letter_count = dead_letter_count + 1,
         last_failed_job_id = ?,
         last_error = ?,
         dead_lettered_at = COALESCE(dead_lettered_at, CURRENT_TIMESTAMP(3))
     WHERE id = ? AND job_id = ? AND status NOT IN ('completed', 'dead_letter')`,
    [deliveryAttempts, jobId, reason.slice(0, 500), id, jobId]
  );
}

async function prepareDeadLetterRetry(pool: Pool, id: string): Promise<OutboxRow> {
  return inTransaction(pool, async (connection) => {
    const [rows] = await connection.query<OutboxRow[]>("SELECT * FROM notification_outbox WHERE id = ? FOR UPDATE", [id]);
    const row = rows[0];
    if (!row) throw new Error(`Outbox record ${id} does not exist`);
    if (row.status !== "dead_letter") return row;
    const retryGeneration = row.retry_generation + 1;
    const jobId = notificationJobId(row.shipment_id, retryGeneration);
    await connection.execute(
      `UPDATE notification_outbox
       SET status = 'pending', job_id = ?, retry_generation = ?, delivery_attempts = 0,
           dead_lettered_at = NULL, enqueued_at = NULL
       WHERE id = ? AND status = 'dead_letter'`,
      [jobId, retryGeneration, id]
    );
    return { ...row, status: "pending", job_id: jobId, retry_generation: retryGeneration, delivery_attempts: 0 };
  });
}

export async function enqueueOutbox(pool: Pool, queue: Queue, id: string): Promise<"completed" | "enqueued" | "dead_lettered"> {
  let row = await outboxRow(pool, id);
  if (!row) throw new Error(`Outbox record ${id} does not exist`);
  if (row.status === "completed") return "completed";
  if (row.status === "dead_letter") row = await prepareDeadLetterRetry(pool, id);
  const existing = await queue.getJob(row.job_id);
  if (existing && await existing.getState() === "failed") {
    await markOutboxDeadLetter(pool, row.id, row.job_id, existing.attemptsMade, existing.failedReason ?? "BullMQ job exhausted");
    return "dead_lettered";
  }
  const payload = typeof row.payload === "string" ? (JSON.parse(row.payload) as Record<string, unknown>) : row.payload;
  try {
    await queue.add("send-dispatch-notification", { outboxId: row.id, ...payload }, {
      jobId: row.job_id,
      attempts: NOTIFICATION_JOB_ATTEMPTS,
      backoff: { type: "exponential", delay: 250 },
      removeOnComplete: false,
      removeOnFail: false
    });
    await pool.execute(
      `UPDATE notification_outbox
       SET status = 'enqueued', enqueued_at = COALESCE(enqueued_at, CURRENT_TIMESTAMP(3)), last_error = NULL
       WHERE id = ? AND status <> 'completed'`,
      [id]
    );
    return "enqueued";
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown Redis failure";
    await pool.execute(
      "UPDATE notification_outbox SET attempts = attempts + 1, last_error = ? WHERE id = ? AND status <> 'completed'",
      [message, id]
    );
    throw error;
  }
}

export async function reconcileOutbox(pool: Pool, queue: Queue, batchSize: number): Promise<{ examined: number; enqueued: number; deadLettered: number; failed: number }> {
  const [rows] = await pool.query<OutboxRow[]>(
    `SELECT * FROM notification_outbox
     WHERE status IN ('pending', 'enqueued', 'dead_letter')
     ORDER BY created_at, id
     LIMIT ?`,
    [batchSize]
  );
  let enqueued = 0;
  let deadLettered = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const result = await enqueueOutbox(pool, queue, row.id);
      if (result === "dead_lettered") deadLettered += 1;
      else enqueued += 1;
    } catch {
      failed += 1;
    }
  }
  return { examined: rows.length, enqueued, deadLettered, failed };
}

export async function countReconciliableOutbox(pool: Pool): Promise<number> {
  const [rows] = await pool.query<(RowDataPacket & { count: number })[]>(
    "SELECT COUNT(*) AS count FROM notification_outbox WHERE status IN ('pending', 'enqueued', 'dead_letter')"
  );
  return rows[0]?.count ?? 0;
}

export function createNotificationWorker(config: AppConfig, pool: Pool): { worker: Worker; redis: Redis } {
  const redis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
    connectTimeout: 3000,
    retryStrategy: (attempt) => Math.min(attempt * 250, 3000)
  });
  redis.on("error", () => undefined);
  const worker = new Worker(
    NOTIFICATION_QUEUE,
    async (job: Job<{ outboxId: string; shipmentId: string; kind: string }>) => {
      await inTransaction(pool, async (connection) => {
        const [rows] = await connection.query<OutboxRow[]>("SELECT * FROM notification_outbox WHERE id = ? FOR UPDATE", [job.data.outboxId]);
        const row = rows[0];
        if (!row) throw new Error(`Outbox record ${job.data.outboxId} is missing`);
        if (row.status === "completed") return;
        const payload = typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload);
        await connection.execute(
          `INSERT INTO notifications (id, outbox_id, shipment_id, kind, payload)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE id = VALUES(id)`,
          [`notification-${row.id}`, row.id, row.shipment_id, job.data.kind, payload]
        );
        await connection.execute(
          `UPDATE notification_outbox
           SET status = 'completed', completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP(3)),
               delivery_attempts = GREATEST(delivery_attempts, ?), last_error = NULL
           WHERE id = ?`,
          [job.attemptsMade + 1, row.id]
        );
      });
    },
    { connection: redis, concurrency: 4 }
  );
  let lastConnectionErrorAt = 0;
  worker.on("error", (error) => {
    const now = Date.now();
    if (now - lastConnectionErrorAt < 5_000) return;
    lastConnectionErrorAt = now;
    console.error(JSON.stringify({ event: "worker-connection-error", message: error.message }));
  });
  worker.on("failed", (job, error) => {
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    void markOutboxDeadLetter(pool, job.data.outboxId, String(job.id), job.attemptsMade, error.message).catch((databaseError) => {
      console.error(JSON.stringify({
        event: "outbox-dead-letter-write-failed",
        jobId: job.id,
        message: databaseError instanceof Error ? databaseError.message : "Unknown database error"
      }));
    });
  });
  return { worker, redis };
}

export async function pingRedis(config: AppConfig): Promise<void> {
  const redis = producerRedis(config);
  try {
    await redis.connect();
    await redis.ping();
  } finally {
    redis.disconnect();
  }
}
