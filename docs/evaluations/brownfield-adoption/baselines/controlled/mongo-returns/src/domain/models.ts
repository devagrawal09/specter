import { ObjectId } from "mongodb";

export type ReturnStatus =
  | "requested"
  | "received"
  | "inspected"
  | "rejected"
  | "refunded";
export type InspectionResult = "accepted" | "rejected";

export interface ReturnDocument {
  _id: string;
  orderId: string;
  customerId: string;
  itemSku: string;
  reason: string;
  status: ReturnStatus;
  refundAmountCents: number;
  currency: "USD";
  receivedAt: Date | null;
  inspectedAt: Date | null;
  inspectionResult: InspectionResult | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface ApprovalDocument {
  _id: string;
  returnId: string;
  amountCents: number;
  currency: "USD";
  approvedAt: Date;
  processedAt: Date | null;
  providerReference: string | null;
}

export interface ReminderDocument {
  _id: string;
  returnId: string;
  dueAt: Date;
  state: "scheduled" | "cancelled" | "sent";
  cancelledAt: Date | null;
  sentAt: Date | null;
}

export interface HistoryDocument {
  _id: string;
  returnId: string;
  eventKey: string;
  eventType: string;
  occurredAt: Date;
  metadata: Record<string, unknown>;
}

export interface AgendaJobDocument {
  _id?: ObjectId;
  name: string;
  data: {
    returnId: string;
    idempotencyKey: string;
    seedOwner?: string;
    cancelledAt?: Date;
  };
  type: "normal";
  priority: number;
  nextRunAt: Date | null;
  lockedAt: Date | null;
  disabled?: boolean;
  lastRunAt?: Date;
  lastFinishedAt?: Date;
  failCount?: number;
  failReason?: string;
}

export interface PublicReturn {
  id: string;
  orderId: string;
  customerId: string;
  itemSku: string;
  reason: string;
  status: ReturnStatus;
  refundAmountCents: number;
  currency: "USD";
  receivedAt: string | null;
  inspectedAt: string | null;
  inspectionResult: InspectionResult | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicApproval {
  id: string;
  returnId: string;
  amountCents: number;
  currency: "USD";
  approvedAt: string;
  processedAt: string | null;
  providerReference: string | null;
}

export function toPublicReturn(document: ReturnDocument): PublicReturn {
  return {
    id: document._id,
    orderId: document.orderId,
    customerId: document.customerId,
    itemSku: document.itemSku,
    reason: document.reason,
    status: document.status,
    refundAmountCents: document.refundAmountCents,
    currency: document.currency,
    receivedAt: document.receivedAt?.toISOString() ?? null,
    inspectedAt: document.inspectedAt?.toISOString() ?? null,
    inspectionResult: document.inspectionResult,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

export function toPublicApproval(document: ApprovalDocument): PublicApproval {
  return {
    id: document._id,
    returnId: document.returnId,
    amountCents: document.amountCents,
    currency: document.currency,
    approvedAt: document.approvedAt.toISOString(),
    processedAt: document.processedAt?.toISOString() ?? null,
    providerReference: document.providerReference,
  };
}
