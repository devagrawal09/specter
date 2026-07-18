import { describe, expect, it } from "vitest";
import { assertCanDispatch } from "../src/domain.js";
import { AppError } from "../src/errors.js";
import { shipment } from "./fixtures.js";

describe("dispatch decision", () => {
  it("accepts a pending, paid, allocated shipment", () => {
    expect(() => assertCanDispatch(shipment)).not.toThrow();
  });

  it.each([
    [{ ...shipment, status: "dispatched" as const }, "INVALID_TRANSITION"],
    [{ ...shipment, status: "cancelled" as const }, "INVALID_TRANSITION"],
    [{ ...shipment, paymentCaptured: false }, "PAYMENT_NOT_CAPTURED"],
    [{ ...shipment, inventoryAllocated: false }, "INVENTORY_NOT_ALLOCATED"]
  ])("rejects invalid persisted state", (candidate, code) => {
    try {
      assertCanDispatch(candidate);
      throw new Error("expected dispatch to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(code);
      expect((error as AppError).status).toBe(409);
    }
  });
});
