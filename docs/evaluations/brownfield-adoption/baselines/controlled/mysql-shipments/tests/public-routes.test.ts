import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { AppError } from "../src/errors.js";
import type { DispatchResponse, ShipmentService } from "../src/service.js";
import { history, shipment } from "./fixtures.js";

const dispatchedShipment = {
  ...shipment,
  status: "dispatched" as const,
  dispatchedAt: "2025-01-10T11:00:00.000Z",
  updatedAt: "2025-01-10T11:00:00.000Z"
};

const dispatchFailures: Record<string, AppError> = {
  missing: new AppError(404, "NOT_FOUND", "Shipment not found"),
  dispatched: new AppError(409, "INVALID_TRANSITION", "Shipment has already been dispatched"),
  unpaid: new AppError(409, "PAYMENT_NOT_CAPTURED", "Payment must be captured before dispatch"),
  unallocated: new AppError(409, "INVENTORY_NOT_ALLOCATED", "Inventory must be allocated before dispatch")
};

function service(): ShipmentService {
  return {
    list: vi.fn(async () => [shipment]),
    get: vi.fn(async () => shipment),
    history: vi.fn(async () => [history]),
    create: vi.fn(async () => shipment),
    dispatch: vi.fn(async (id): Promise<DispatchResponse> => {
      const failure = dispatchFailures[id];
      if (failure) throw failure;
      return {
        shipment: dispatchedShipment,
        notification: { id: "outbox-dispatch-shp-ready-001", jobId: "notify-dispatch-shp-ready-001", delivery: "enqueued" }
      };
    })
  };
}

const dependencies = (shipmentService: ShipmentService = service()) => ({
  service: shipmentService,
  readiness: async () => ({ mysql: "up" as const, redis: "up" as const })
});

describe("frozen public route contract", () => {
  it("freezes the legacy list reader envelope and every shipment field", async () => {
    const response = await createApp(dependencies()).request("/shipments");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { shipments: [shipment] } });
  });

  it("freezes the legacy detail reader envelope and every shipment field", async () => {
    const response = await createApp(dependencies()).request("/shipments/shp-ready-001");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { shipment } });
  });

  it("freezes the legacy history reader envelope and every history field", async () => {
    const response = await createApp(dependencies()).request("/shipments/shp-ready-001/history");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { history: [history] } });
  });

  it("freezes create status, envelope, and parsed fields", async () => {
    const shipmentService = service();
    const response = await createApp(dependencies(shipmentService)).request("/shipments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reference: shipment.reference, recipientName: shipment.recipientName, paymentCaptured: true, inventoryAllocated: true })
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, data: { shipment } });
    expect(shipmentService.create).toHaveBeenCalledWith({
      reference: "LEGACY-READY-001",
      recipientName: "Ada Lovelace",
      paymentCaptured: true,
      inventoryAllocated: true
    });
  });

  it("freezes the dispatch success envelope and durable handoff identifiers", async () => {
    const response = await createApp(dependencies()).request("/shipments/ready/dispatch", { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: {
        shipment: dispatchedShipment,
        notification: {
          id: "outbox-dispatch-shp-ready-001",
          jobId: "notify-dispatch-shp-ready-001",
          delivery: "enqueued"
        }
      }
    });
  });

  it.each([
    ["missing", 404, "NOT_FOUND", "Shipment not found"],
    ["dispatched", 409, "INVALID_TRANSITION", "Shipment has already been dispatched"],
    ["unpaid", 409, "PAYMENT_NOT_CAPTURED", "Payment must be captured before dispatch"],
    ["unallocated", 409, "INVENTORY_NOT_ALLOCATED", "Inventory must be allocated before dispatch"]
  ] as const)("freezes the %s dispatch guard", async (id, status, code, message) => {
    const response = await createApp(dependencies()).request(`/shipments/${id}/dispatch`, { method: "POST" });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, error: { code, message } });
  });

  it("freezes malformed JSON and validation error shapes", async () => {
    const app = createApp(dependencies());
    const malformed = await app.request("/shipments", { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ ok: false, error: { code: "BAD_JSON", message: "Request body must be valid JSON" } });

    const invalid = await app.request("/shipments", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request body is invalid",
        details: [
          { path: "reference", message: "Invalid input: expected string, received undefined" },
          { path: "recipientName", message: "Invalid input: expected string, received undefined" },
          { path: "paymentCaptured", message: "Invalid input: expected boolean, received undefined" },
          { path: "inventoryAllocated", message: "Invalid input: expected boolean, received undefined" }
        ]
      }
    });
  });

  it("freezes readiness success and failure envelopes", async () => {
    const ready = await createApp(dependencies()).request("/health/ready");
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ ok: true, data: { status: "ready", dependencies: { mysql: "up", redis: "up" } } });
    const unavailable = await createApp({ service: service(), readiness: async () => { throw new Error("down"); } }).request("/health/ready");
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ ok: false, error: { code: "NOT_READY", message: "A required dependency is unavailable" } });
  });
});
