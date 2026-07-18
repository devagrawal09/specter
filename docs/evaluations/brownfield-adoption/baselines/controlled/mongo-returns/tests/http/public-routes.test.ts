import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { PublicReturn } from "../../src/domain/models.js";
import { AppError } from "../../src/errors.js";

const publicReturn: PublicReturn = {
  id: "ret-legacy",
  orderId: "ord-legacy",
  customerId: "cus-legacy",
  itemSku: "SKU-LEGACY",
  reason: "Too small",
  status: "inspected",
  refundAmountCents: 4500,
  currency: "USD",
  receivedAt: "2025-01-02T00:00:00.000Z",
  inspectedAt: "2025-01-03T00:00:00.000Z",
  inspectionResult: "accepted",
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-03T00:00:00.000Z",
};

const service = {
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  receive: vi.fn(),
  inspect: vi.fn(),
  approveRefund: vi.fn(),
};
const app = createApp(service);

beforeEach(() => {
  vi.resetAllMocks();
  service.list.mockResolvedValue([publicReturn]);
  service.get.mockResolvedValue(publicReturn);
  service.create.mockResolvedValue({ ...publicReturn, status: "requested" });
  service.receive.mockResolvedValue({ ...publicReturn, status: "received" });
  service.inspect.mockResolvedValue(publicReturn);
  service.approveRefund.mockResolvedValue({
    return: { ...publicReturn, status: "refunded" },
    approval: {
      id: "approval:ret-legacy",
      returnId: "ret-legacy",
      amountCents: 4500,
      currency: "USD",
      approvedAt: "2025-01-04T00:00:00.000Z",
      processedAt: null,
      providerReference: null,
    },
  });
});

describe("public routes", () => {
  it("preserves the legacy collection reader envelope and fields", async () => {
    const response = await request(app).get("/returns").expect(200);
    expect(response.body).toEqual({ ok: true, data: { returns: [publicReturn] } });
  });

  it("returns the stable approval success envelope", async () => {
    const response = await request(app).post("/returns/ret-legacy/approve-refund").send({}).expect(200);
    expect(response.body).toEqual({
      ok: true,
      data: {
        return: { ...publicReturn, status: "refunded" },
        approval: {
          id: "approval:ret-legacy",
          returnId: "ret-legacy",
          amountCents: 4500,
          currency: "USD",
          approvedAt: "2025-01-04T00:00:00.000Z",
          processedAt: null,
          providerReference: null,
        },
      },
    });
  });

  it("returns stable validation, not-found, and conflict errors", async () => {
    const invalid = await request(app)
      .post("/returns/ret-legacy/inspect")
      .send({ outcome: "unknown" })
      .expect(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");

    service.get.mockRejectedValueOnce(new AppError(404, "RETURN_NOT_FOUND", "Return was not found."));
    const missing = await request(app).get("/returns/missing").expect(404);
    expect(missing.body).toEqual({
      ok: false,
      error: { code: "RETURN_NOT_FOUND", message: "Return was not found." },
    });

    service.approveRefund.mockRejectedValueOnce(
      new AppError(409, "RETURN_NOT_INSPECTED", "Return must be inspected before refund approval."),
    );
    const conflict = await request(app).post("/returns/ret-legacy/approve-refund").send({}).expect(409);
    expect(conflict.body).toEqual({
      ok: false,
      error: {
        code: "RETURN_NOT_INSPECTED",
        message: "Return must be inspected before refund approval.",
      },
    });
  });

  it("rejects unknown request fields", async () => {
    const response = await request(app)
      .post("/returns/ret-legacy/approve-refund")
      .send({ amountCents: 1 })
      .expect(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(service.approveRefund).not.toHaveBeenCalled();
  });

  it("returns a stable 503 when MongoDB or Agenda is unavailable", async () => {
    const response = await request(createApp(service, async () => {
      throw new Error("down");
    })).get("/health").expect(503);
    expect(response.body).toEqual({
      ok: false,
      error: { code: "NOT_READY", message: "A required dependency is unavailable." },
    });
  });
});
