import type { Shipment, ShipmentHistory } from "../src/types.js";

export const shipment: Shipment = {
  id: "shp-ready-001",
  reference: "LEGACY-READY-001",
  recipientName: "Ada Lovelace",
  status: "pending",
  paymentCaptured: true,
  inventoryAllocated: true,
  dispatchedAt: null,
  createdAt: "2025-01-10T10:00:00.000Z",
  updatedAt: "2025-01-10T10:00:00.000Z"
};

export const history: ShipmentHistory = {
  id: "hist-import-shp-ready-001",
  shipmentId: shipment.id,
  eventKey: "shipment-imported-shp-ready-001",
  eventType: "shipment.imported",
  fromStatus: null,
  toStatus: "pending",
  metadata: { source: "legacy-snapshot" },
  occurredAt: "2025-01-10T10:00:00.000Z"
};
