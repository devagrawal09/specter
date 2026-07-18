import { randomUUID } from "node:crypto";
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { assertCanDispatch } from "./domain.js";
import { AppError } from "./errors.js";
import { inTransaction } from "./db.js";
import { notificationJobId } from "./queue.js";
import type { CreateShipmentInput, NotificationOutbox, Shipment, ShipmentHistory } from "./types.js";

type ShipmentRow = RowDataPacket & {
  id: string;
  reference: string;
  recipient_name: string;
  status: Shipment["status"];
  payment_captured: number;
  inventory_allocated: number;
  dispatched_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type HistoryRow = RowDataPacket & {
  id: string;
  shipment_id: string;
  event_key: string;
  event_type: string;
  from_status: Shipment["status"] | null;
  to_status: Shipment["status"];
  metadata: string | Record<string, unknown>;
  occurred_at: Date;
};

export type DispatchResult = {
  shipment: Shipment;
  notification: NotificationOutbox;
};

export interface ShipmentStore {
  list(): Promise<Shipment[]>;
  get(id: string): Promise<Shipment>;
  history(id: string): Promise<ShipmentHistory[]>;
  create(input: CreateShipmentInput): Promise<Shipment>;
  dispatch(id: string): Promise<DispatchResult>;
}

function iso(value: Date): string {
  return value.toISOString();
}

export function mapShipment(row: ShipmentRow): Shipment {
  return {
    id: row.id,
    reference: row.reference,
    recipientName: row.recipient_name,
    status: row.status,
    paymentCaptured: Boolean(row.payment_captured),
    inventoryAllocated: Boolean(row.inventory_allocated),
    dispatchedAt: row.dispatched_at ? iso(row.dispatched_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at)
  };
}

function mapHistory(row: HistoryRow): ShipmentHistory {
  return {
    id: row.id,
    shipmentId: row.shipment_id,
    eventKey: row.event_key,
    eventType: row.event_type,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    metadata: typeof row.metadata === "string" ? (JSON.parse(row.metadata) as Record<string, unknown>) : row.metadata,
    occurredAt: iso(row.occurred_at)
  };
}

async function selectShipment(connection: Pool | PoolConnection, id: string, forUpdate = false): Promise<ShipmentRow | undefined> {
  const suffix = forUpdate ? " FOR UPDATE" : "";
  const [rows] = await connection.query<ShipmentRow[]>(`SELECT * FROM shipments WHERE id = ?${suffix}`, [id]);
  return rows[0];
}

function isDuplicate(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY";
}

export class MysqlShipmentStore implements ShipmentStore {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<Shipment[]> {
    const [rows] = await this.pool.query<ShipmentRow[]>("SELECT * FROM shipments ORDER BY created_at, id");
    return rows.map(mapShipment);
  }

  async get(id: string): Promise<Shipment> {
    const row = await selectShipment(this.pool, id);
    if (!row) throw new AppError(404, "NOT_FOUND", "Shipment not found");
    return mapShipment(row);
  }

  async history(id: string): Promise<ShipmentHistory[]> {
    await this.get(id);
    const [rows] = await this.pool.query<HistoryRow[]>(
      "SELECT * FROM shipment_history WHERE shipment_id = ? ORDER BY occurred_at, id",
      [id]
    );
    return rows.map(mapHistory);
  }

  async create(input: CreateShipmentInput): Promise<Shipment> {
    const id = `shp-${randomUUID()}`;
    try {
      await inTransaction(this.pool, async (connection) => {
        await connection.execute<ResultSetHeader>(
          `INSERT INTO shipments
            (id, reference, recipient_name, status, payment_captured, inventory_allocated)
           VALUES (?, ?, ?, 'pending', ?, ?)`,
          [id, input.reference, input.recipientName, input.paymentCaptured, input.inventoryAllocated]
        );
        await connection.execute(
          `INSERT INTO shipment_history
            (id, shipment_id, event_key, event_type, from_status, to_status, metadata)
           VALUES (?, ?, ?, 'shipment.created', NULL, 'pending', JSON_OBJECT('source', 'public-api'))`,
          [`hist-create-${id}`, id, `shipment-created-${id}`]
        );
      });
    } catch (error) {
      if (isDuplicate(error)) throw new AppError(409, "REFERENCE_CONFLICT", "Shipment reference already exists");
      throw error;
    }
    return this.get(id);
  }

  async dispatch(id: string): Promise<DispatchResult> {
    return inTransaction(this.pool, async (connection) => {
      const row = await selectShipment(connection, id, true);
      if (!row) throw new AppError(404, "NOT_FOUND", "Shipment not found");
      const shipment = mapShipment(row);
      assertCanDispatch(shipment);

      await connection.execute(
        "UPDATE shipments SET status = 'dispatched', dispatched_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
        [id]
      );
      const eventKey = `shipment-dispatched-${id}`;
      const historyId = `hist-dispatch-${id}`;
      const outboxId = `outbox-dispatch-${id}`;
      const jobId = notificationJobId(id);
      const payload = { shipmentId: id, reference: shipment.reference, kind: "shipment.dispatched" };
      await connection.execute(
        `INSERT INTO shipment_history
          (id, shipment_id, event_key, event_type, from_status, to_status, metadata)
         VALUES (?, ?, ?, 'shipment.dispatched', 'pending', 'dispatched', JSON_OBJECT('source', 'public-api'))`,
        [historyId, id, eventKey]
      );
      await connection.execute(
        `INSERT INTO notification_outbox
          (id, shipment_id, event_key, job_id, payload, status)
         VALUES (?, ?, ?, ?, ?, 'pending')`,
        [outboxId, id, eventKey, jobId, JSON.stringify(payload)]
      );
      const updated = await selectShipment(connection, id);
      if (!updated) throw new Error("Shipment disappeared during dispatch transaction");
      return {
        shipment: mapShipment(updated),
        notification: { id: outboxId, shipmentId: id, eventKey, jobId, status: "pending" }
      };
    });
  }
}
