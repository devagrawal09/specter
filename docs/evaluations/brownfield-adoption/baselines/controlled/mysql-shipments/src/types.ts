export const shipmentStatuses = ["pending", "dispatched", "cancelled"] as const;
export type ShipmentStatus = (typeof shipmentStatuses)[number];

export type Shipment = {
  id: string;
  reference: string;
  recipientName: string;
  status: ShipmentStatus;
  paymentCaptured: boolean;
  inventoryAllocated: boolean;
  dispatchedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ShipmentHistory = {
  id: string;
  shipmentId: string;
  eventKey: string;
  eventType: string;
  fromStatus: ShipmentStatus | null;
  toStatus: ShipmentStatus;
  metadata: Record<string, unknown>;
  occurredAt: string;
};

export type NotificationOutbox = {
  id: string;
  shipmentId: string;
  eventKey: string;
  jobId: string;
  status: "pending" | "enqueued" | "completed" | "dead_letter";
};

export type CreateShipmentInput = {
  reference: string;
  recipientName: string;
  paymentCaptured: boolean;
  inventoryAllocated: boolean;
};
