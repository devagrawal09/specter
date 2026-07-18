import type { Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig, type AppConfig } from "../src/config.js";
import { createPool, pingDatabase } from "../src/db.js";
import { runMigrations } from "../src/migrations.js";
import { closeQueueResources, createQueueResources, pingRedis, type QueueResources } from "../src/queue.js";
import { MysqlShipmentStore } from "../src/repository.js";
import { seedLegacyData } from "../src/seed.js";
import { DefaultShipmentService } from "../src/service.js";
import { liveEnabled, removeShipmentByReference } from "./live-helpers.js";

const suite = liveEnabled ? describe : describe.skip;

const legacyShipments = [
  { id: "shp-ready-001", reference: "LEGACY-READY-001", recipientName: "Ada Lovelace", status: "pending", paymentCaptured: true, inventoryAllocated: true, dispatchedAt: null, createdAt: "2025-01-10T10:00:00.000Z", updatedAt: "2025-01-10T10:00:00.000Z" },
  { id: "shp-payment-002", reference: "LEGACY-PAYMENT-002", recipientName: "Grace Hopper", status: "pending", paymentCaptured: false, inventoryAllocated: true, dispatchedAt: null, createdAt: "2025-01-10T10:01:00.000Z", updatedAt: "2025-01-10T10:01:00.000Z" },
  { id: "shp-inventory-003", reference: "LEGACY-INVENTORY-003", recipientName: "Katherine Johnson", status: "pending", paymentCaptured: true, inventoryAllocated: false, dispatchedAt: null, createdAt: "2025-01-10T10:02:00.000Z", updatedAt: "2025-01-10T10:02:00.000Z" },
  { id: "shp-cancelled-004", reference: "LEGACY-CANCELLED-004", recipientName: "Margaret Hamilton", status: "cancelled", paymentCaptured: true, inventoryAllocated: true, dispatchedAt: null, createdAt: "2025-01-10T10:03:00.000Z", updatedAt: "2025-01-10T10:03:00.000Z" },
  { id: "shp-dispatched-005", reference: "LEGACY-DISPATCHED-005", recipientName: "Dorothy Vaughan", status: "dispatched", paymentCaptured: true, inventoryAllocated: true, dispatchedAt: "2025-01-10T11:04:00.000Z", createdAt: "2025-01-10T10:04:00.000Z", updatedAt: "2025-01-10T10:04:00.000Z" }
];

suite("live frozen HTTP compatibility", () => {
  let pool: Pool;
  let config: AppConfig;
  let queue: QueueResources;
  let app: ReturnType<typeof createApp>;
  const reference = "LIVE-HTTP-DISPATCH-001";

  beforeAll(async () => {
    config = loadConfig();
    pool = createPool(config);
    await runMigrations(pool);
    await seedLegacyData(pool);
    await removeShipmentByReference(pool, reference);
    queue = createQueueResources(config);
    app = createApp({
      service: new DefaultShipmentService(new MysqlShipmentStore(pool), pool, queue.queue),
      readiness: async () => {
        await Promise.all([pingDatabase(pool), pingRedis(config)]);
        return { mysql: "up", redis: "up" };
      }
    });
  });

  afterAll(async () => {
    await removeShipmentByReference(pool, reference);
    await closeQueueResources(queue);
    await pool.end();
  });

  it("freezes readiness and all three legacy reader envelopes over HTTP", async () => {
    const readiness = await app.request("/health/ready");
    expect(readiness.status).toBe(200);
    expect(await readiness.json()).toEqual({ ok: true, data: { status: "ready", dependencies: { mysql: "up", redis: "up" } } });

    const list = await app.request("/shipments");
    expect(list.status).toBe(200);
    const listBody = await list.json() as { ok: boolean; data: { shipments: typeof legacyShipments } };
    expect(Object.keys(listBody)).toEqual(["ok", "data"]);
    expect(Object.keys(listBody.data)).toEqual(["shipments"]);
    expect(listBody.data.shipments.filter((shipment) => shipment.id.startsWith("shp-") && shipment.reference.startsWith("LEGACY-"))).toEqual(legacyShipments);

    const detail = await app.request("/shipments/shp-dispatched-005");
    expect(detail.status).toBe(200);
    expect(await detail.json()).toEqual({ ok: true, data: { shipment: legacyShipments[4] } });

    const history = await app.request("/shipments/shp-payment-002/history");
    expect(history.status).toBe(200);
    expect(await history.json()).toEqual({
      ok: true,
      data: {
        history: [{
          id: "hist-import-shp-payment-002",
          shipmentId: "shp-payment-002",
          eventKey: "shipment-imported-shp-payment-002",
          eventType: "shipment.imported",
          fromStatus: null,
          toStatus: "pending",
          metadata: { source: "legacy-snapshot" },
          occurredAt: "2025-01-10T10:01:00.000Z"
        }]
      }
    });
  });

  it.each([
    ["shp-missing", 404, "NOT_FOUND", "Shipment not found"],
    ["shp-dispatched-005", 409, "INVALID_TRANSITION", "Shipment has already been dispatched"],
    ["shp-payment-002", 409, "PAYMENT_NOT_CAPTURED", "Payment must be captured before dispatch"],
    ["shp-inventory-003", 409, "INVENTORY_NOT_ALLOCATED", "Inventory must be allocated before dispatch"]
  ] as const)("freezes live dispatch guard %s", async (id, status, code, message) => {
    const response = await app.request(`/shipments/${id}/dispatch`, { method: "POST" });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, error: { code, message } });
  });

  it("freezes live create and successful dispatch envelope fields", async () => {
    const createdResponse = await app.request("/shipments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reference, recipientName: "Live HTTP", paymentCaptured: true, inventoryAllocated: true })
    });
    expect(createdResponse.status).toBe(201);
    const createdBody = await createdResponse.json() as { data: { shipment: { id: string } } };
    const id = createdBody.data.shipment.id;
    expect(createdBody).toEqual({
      ok: true,
      data: {
        shipment: {
          id,
          reference,
          recipientName: "Live HTTP",
          status: "pending",
          paymentCaptured: true,
          inventoryAllocated: true,
          dispatchedAt: null,
          createdAt: expect.any(String),
          updatedAt: expect.any(String)
        }
      }
    });

    const dispatched = await app.request(`/shipments/${id}/dispatch`, { method: "POST" });
    expect(dispatched.status).toBe(200);
    expect(await dispatched.json()).toEqual({
      ok: true,
      data: {
        shipment: {
          id,
          reference,
          recipientName: "Live HTTP",
          status: "dispatched",
          paymentCaptured: true,
          inventoryAllocated: true,
          dispatchedAt: expect.any(String),
          createdAt: expect.any(String),
          updatedAt: expect.any(String)
        },
        notification: {
          id: `outbox-dispatch-${id}`,
          jobId: `notify-dispatch-${id}`,
          delivery: "enqueued"
        }
      }
    });
  });
});
