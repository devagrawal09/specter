import type { Pool } from "mysql2/promise";
import { inTransaction } from "./db.js";

const legacyShipments = [
  { id: "shp-ready-001", reference: "LEGACY-READY-001", recipient: "Ada Lovelace", status: "pending", paid: true, allocated: true, dispatchedAt: null, createdAt: "2025-01-10 10:00:00.000" },
  { id: "shp-payment-002", reference: "LEGACY-PAYMENT-002", recipient: "Grace Hopper", status: "pending", paid: false, allocated: true, dispatchedAt: null, createdAt: "2025-01-10 10:01:00.000" },
  { id: "shp-inventory-003", reference: "LEGACY-INVENTORY-003", recipient: "Katherine Johnson", status: "pending", paid: true, allocated: false, dispatchedAt: null, createdAt: "2025-01-10 10:02:00.000" },
  { id: "shp-cancelled-004", reference: "LEGACY-CANCELLED-004", recipient: "Margaret Hamilton", status: "cancelled", paid: true, allocated: true, dispatchedAt: null, createdAt: "2025-01-10 10:03:00.000" },
  { id: "shp-dispatched-005", reference: "LEGACY-DISPATCHED-005", recipient: "Dorothy Vaughan", status: "dispatched", paid: true, allocated: true, dispatchedAt: "2025-01-10 11:04:00.000", createdAt: "2025-01-10 10:04:00.000" }
] as const;

export const legacySnapshotIds = legacyShipments.map((shipment) => shipment.id);

export async function seedLegacyData(pool: Pool): Promise<void> {
  await inTransaction(pool, async (connection) => {
    for (const shipment of legacyShipments) {
      await connection.execute(
        `INSERT INTO shipments
          (id, reference, recipient_name, status, payment_captured, inventory_allocated, dispatched_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          reference = VALUES(reference), recipient_name = VALUES(recipient_name),
          payment_captured = VALUES(payment_captured), inventory_allocated = VALUES(inventory_allocated)`,
        [shipment.id, shipment.reference, shipment.recipient, shipment.status, shipment.paid, shipment.allocated, shipment.dispatchedAt, shipment.createdAt, shipment.createdAt]
      );
      await connection.execute(
        `INSERT INTO shipment_history
          (id, shipment_id, event_key, event_type, from_status, to_status, metadata, occurred_at)
         VALUES (?, ?, ?, 'shipment.imported', NULL, ?, JSON_OBJECT('source', 'legacy-snapshot'), ?)
         ON DUPLICATE KEY UPDATE metadata = VALUES(metadata)`,
        [`hist-import-${shipment.id}`, shipment.id, `shipment-imported-${shipment.id}`, shipment.status, shipment.createdAt]
      );
    }

    const dispatched = legacyShipments[4];
    const eventKey = `shipment-dispatched-${dispatched.id}`;
    await connection.execute(
      `INSERT INTO shipment_history
        (id, shipment_id, event_key, event_type, from_status, to_status, metadata, occurred_at)
       VALUES (?, ?, ?, 'shipment.dispatched', 'pending', 'dispatched', JSON_OBJECT('source', 'legacy-snapshot'), ?)
       ON DUPLICATE KEY UPDATE metadata = VALUES(metadata)`,
      [`hist-dispatch-${dispatched.id}`, dispatched.id, eventKey, dispatched.dispatchedAt]
    );
    await connection.execute(
      `INSERT INTO notification_outbox
        (id, shipment_id, event_key, job_id, payload, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)
       ON DUPLICATE KEY UPDATE payload = VALUES(payload)`,
      [
        `outbox-dispatch-${dispatched.id}`,
        dispatched.id,
        eventKey,
        `notify-dispatch-${dispatched.id}`,
        JSON.stringify({ shipmentId: dispatched.id, reference: dispatched.reference, kind: "shipment.dispatched" }),
        dispatched.dispatchedAt
      ]
    );
  });
}
