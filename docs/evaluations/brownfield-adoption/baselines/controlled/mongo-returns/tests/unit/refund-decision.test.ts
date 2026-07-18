import { describe, expect, it } from "vitest";
import { ReturnDocument } from "../../src/domain/models.js";
import { assertRefundApprovable } from "../../src/domain/refund-decision.js";
import { AppError } from "../../src/errors.js";

const date = new Date("2025-02-01T00:00:00.000Z");
const eligible: ReturnDocument = {
  _id: "ret-unit",
  orderId: "ord-unit",
  customerId: "cus-unit",
  itemSku: "SKU-UNIT",
  reason: "test",
  status: "inspected",
  refundAmountCents: 1000,
  currency: "USD",
  receivedAt: date,
  inspectedAt: date,
  inspectionResult: "accepted",
  createdAt: date,
  updatedAt: date,
  version: 3,
};

function expectCode(document: ReturnDocument, code: string): void {
  try {
    assertRefundApprovable(document);
    throw new Error("expected decision to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    expect((error as AppError).status).toBe(409);
  }
}

describe("refund approval decision", () => {
  it("accepts only received and accepted inspection state", () => {
    expect(() => assertRefundApprovable(eligible)).not.toThrow();
  });

  it("rejects a return that has not been received", () => {
    expectCode({ ...eligible, status: "requested", receivedAt: null, inspectedAt: null, inspectionResult: null }, "RETURN_NOT_RECEIVED");
  });

  it("rejects a return that has not been inspected", () => {
    expectCode({ ...eligible, status: "received", inspectedAt: null, inspectionResult: null }, "RETURN_NOT_INSPECTED");
  });

  it("rejects a failed inspection", () => {
    expectCode({ ...eligible, status: "rejected", inspectionResult: "rejected" }, "INSPECTION_REJECTED");
  });

  it("rejects repeat approval", () => {
    expectCode({ ...eligible, status: "refunded" }, "REFUND_ALREADY_APPROVED");
  });
});
