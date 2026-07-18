import { ClientSession, Db } from "mongodb";
import { AGENDA_COLLECTION } from "../config.js";
import { AgendaJobDocument } from "../domain/models.js";

export const REMINDER_JOB = "returns:send-receipt-reminder";
export const REFUND_JOB = "returns:process-refund";

export class JobRepository {
  constructor(private readonly db: Db) {}

  async scheduleReminder(
    returnId: string,
    nextRunAt: Date,
    session?: ClientSession,
  ): Promise<void> {
    const key = `reminder:${returnId}`;
    await this.db.collection<AgendaJobDocument>(AGENDA_COLLECTION).updateOne(
      { "data.idempotencyKey": key },
      {
        $set: {
          name: REMINDER_JOB,
          data: { returnId, idempotencyKey: key },
          type: "normal",
          priority: 0,
          nextRunAt,
          lockedAt: null,
          disabled: false,
        },
        $unset: {
          lastRunAt: "",
          lastFinishedAt: "",
          failCount: "",
          failReason: "",
        },
      },
      { upsert: true, ...(session === undefined ? {} : { session }) },
    );
  }

  async cancelReminder(returnId: string, cancelledAt: Date, session: ClientSession): Promise<void> {
    await this.db.collection<AgendaJobDocument>(AGENDA_COLLECTION).updateOne(
      { "data.idempotencyKey": `reminder:${returnId}` },
      {
        $set: {
          disabled: true,
          nextRunAt: null,
          lockedAt: null,
          "data.cancelledAt": cancelledAt,
        },
      },
      { session },
    );
  }

  async queueRefund(returnId: string, approvedAt: Date, session: ClientSession): Promise<void> {
    const key = `refund:${returnId}`;
    await this.db.collection<AgendaJobDocument>(AGENDA_COLLECTION).updateOne(
      { "data.idempotencyKey": key },
      {
        $setOnInsert: {
          name: REFUND_JOB,
          data: { returnId, idempotencyKey: key },
          type: "normal",
          priority: 10,
          nextRunAt: approvedAt,
          lockedAt: null,
          disabled: false,
        },
      },
      { upsert: true, session },
    );
  }
}
