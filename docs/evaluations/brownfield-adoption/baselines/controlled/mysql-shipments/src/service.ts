import type { Queue } from "bullmq";
import type { Pool } from "mysql2/promise";
import { enqueueOutbox } from "./queue.js";
import type { CreateShipmentInput, Shipment, ShipmentHistory } from "./types.js";
import type { ShipmentStore } from "./repository.js";

export type DispatchResponse = {
  shipment: Shipment;
  notification: { id: string; jobId: string; delivery: "enqueued" | "pending" };
};

export interface ShipmentService {
  list(): Promise<Shipment[]>;
  get(id: string): Promise<Shipment>;
  history(id: string): Promise<ShipmentHistory[]>;
  create(input: CreateShipmentInput): Promise<Shipment>;
  dispatch(id: string): Promise<DispatchResponse>;
}

export class DefaultShipmentService implements ShipmentService {
  constructor(private readonly store: ShipmentStore, private readonly pool: Pool, private readonly queue: Queue) {}

  list(): Promise<Shipment[]> { return this.store.list(); }
  get(id: string): Promise<Shipment> { return this.store.get(id); }
  history(id: string): Promise<ShipmentHistory[]> { return this.store.history(id); }
  create(input: CreateShipmentInput): Promise<Shipment> { return this.store.create(input); }

  async dispatch(id: string): Promise<DispatchResponse> {
    const result = await this.store.dispatch(id);
    let delivery: "enqueued" | "pending" = "pending";
    try {
      const status = await enqueueOutbox(this.pool, this.queue, result.notification.id);
      delivery = status === "enqueued" || status === "completed" ? "enqueued" : "pending";
    } catch {
      // The committed outbox row is the durable handoff. Reconciliation will retry.
    }
    return {
      shipment: result.shipment,
      notification: { id: result.notification.id, jobId: result.notification.jobId, delivery }
    };
  }
}
