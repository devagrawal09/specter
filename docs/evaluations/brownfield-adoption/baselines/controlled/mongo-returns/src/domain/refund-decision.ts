import { AppError } from "../errors.js";
import { ReturnDocument } from "./models.js";

export function assertRefundApprovable(document: ReturnDocument): void {
  if (document.status === "refunded") {
    throw new AppError(409, "REFUND_ALREADY_APPROVED", "Refund was already approved for this return.");
  }
  if (document.receivedAt === null) {
    throw new AppError(409, "RETURN_NOT_RECEIVED", "Return must be received before refund approval.");
  }
  if (document.inspectedAt === null || document.inspectionResult === null) {
    throw new AppError(409, "RETURN_NOT_INSPECTED", "Return must be inspected before refund approval.");
  }
  if (document.inspectionResult === "rejected" || document.status === "rejected") {
    throw new AppError(409, "INSPECTION_REJECTED", "A rejected inspection cannot be refunded.");
  }
  if (document.status !== "inspected") {
    throw new AppError(409, "INVALID_RETURN_STATE", "Return state does not permit refund approval.");
  }
}
