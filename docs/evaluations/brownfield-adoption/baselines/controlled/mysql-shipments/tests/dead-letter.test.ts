import type { Queue } from "bullmq";
import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { enqueueOutbox, notificationJobId, NOTIFICATION_JOB_ATTEMPTS } from "../src/queue.js";

describe("dead-letter recovery primitives", () => {
  it("uses deterministic, non-colliding retry generations", () => {
    expect(notificationJobId("shp-123")).toBe("notify-dispatch-shp-123");
    expect(notificationJobId("shp-123", 1)).toBe("notify-dispatch-shp-123-r1");
    expect(notificationJobId("shp-123", 2)).toBe("notify-dispatch-shp-123-r2");
  });

  it("durably dead-letters an actually exhausted BullMQ job before creating a retry", async () => {
    const execute = vi.fn(async () => [{ affectedRows: 1 }, []]);
    const pool = {
      query: vi.fn(async () => [[{
        id: "outbox-dispatch-shp-123",
        shipment_id: "shp-123",
        event_key: "shipment-dispatched-shp-123",
        job_id: "notify-dispatch-shp-123",
        payload: { shipmentId: "shp-123", kind: "shipment.dispatched" },
        status: "enqueued",
        delivery_attempts: 0,
        retry_generation: 0,
        dead_letter_count: 0
      }], []]),
      execute
    } as unknown as Pool;
    const add = vi.fn();
    const queue = {
      getJob: vi.fn(async () => ({
        getState: async () => "failed",
        attemptsMade: NOTIFICATION_JOB_ATTEMPTS,
        failedReason: "database unavailable"
      })),
      add
    } as unknown as Queue;

    await expect(enqueueOutbox(pool, queue, "outbox-dispatch-shp-123")).resolves.toBe("dead_lettered");
    expect(add).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledOnce();
    const executeCalls = execute.mock.calls as unknown as Array<[string, unknown[]]>;
    expect(executeCalls[0]?.[1]).toEqual([
      NOTIFICATION_JOB_ATTEMPTS,
      "notify-dispatch-shp-123",
      "database unavailable",
      "outbox-dispatch-shp-123",
      "notify-dispatch-shp-123"
    ]);
  });
});
