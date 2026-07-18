import { AppError } from "./errors.js";
import type { Shipment } from "./types.js";

export function assertCanDispatch(shipment: Shipment): void {
  if (shipment.status !== "pending") {
    throw new AppError(
      409,
      "INVALID_TRANSITION",
      shipment.status === "dispatched" ? "Shipment has already been dispatched" : `Shipment cannot be dispatched from ${shipment.status}`
    );
  }
  if (!shipment.paymentCaptured) {
    throw new AppError(409, "PAYMENT_NOT_CAPTURED", "Payment must be captured before dispatch");
  }
  if (!shipment.inventoryAllocated) {
    throw new AppError(409, "INVENTORY_NOT_ALLOCATED", "Inventory must be allocated before dispatch");
  }
}
