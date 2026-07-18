import { Agenda, Job } from "agenda";
import { Db } from "mongodb";
import { AGENDA_COLLECTION } from "../config.js";
import { ApprovalDocument, HistoryDocument, ReminderDocument } from "../domain/models.js";
import { REFUND_JOB, REMINDER_JOB } from "../repositories/job-repository.js";

interface ReturnJobData {
  returnId: string;
  idempotencyKey: string;
}

export const READINESS_JOB = "returns:readiness-probe";

export function createAgenda(
  uri: string,
  db: Db,
  processEveryMs: number,
  onReadinessProbe?: (idempotencyKey: string) => void,
): Agenda {
  const agenda = new Agenda({
    db: {
      address: uri,
      collection: AGENDA_COLLECTION,
      options: {
        connectTimeoutMS: 1_000,
        serverSelectionTimeoutMS: 1_000,
        socketTimeoutMS: 1_000,
        heartbeatFrequencyMS: 500,
        minHeartbeatFrequencyMS: 100,
      },
    },
    processEvery: `${processEveryMs / 1_000} seconds`,
    maxConcurrency: 4,
    defaultConcurrency: 2,
    defaultLockLifetime: 2_000,
  });

  agenda.define(READINESS_JOB, async () => undefined);
  agenda.on(`complete:${READINESS_JOB}`, (job: Job<ReturnJobData>) => {
    onReadinessProbe?.(job.attrs.data.idempotencyKey);
  });

  agenda.define(REMINDER_JOB, async (job: Job<ReturnJobData>) => {
    const now = new Date();
    await db.collection<ReminderDocument>("reminders").updateOne(
      { returnId: job.attrs.data.returnId, state: "scheduled" },
      { $set: { state: "sent", sentAt: now } },
    );
    await db.collection<HistoryDocument>("returnHistory").updateOne(
      { returnId: job.attrs.data.returnId, eventKey: "receipt-reminder-sent" },
      {
        $setOnInsert: {
          _id: `history:${job.attrs.data.returnId}:receipt-reminder-sent`,
          returnId: job.attrs.data.returnId,
          eventKey: "receipt-reminder-sent",
          eventType: "return.receipt-reminder-sent",
          occurredAt: now,
          metadata: {},
        },
      },
      { upsert: true },
    );
  });

  agenda.define(REFUND_JOB, async (job: Job<ReturnJobData>) => {
    const returnId = job.attrs.data.returnId;
    const now = new Date();
    await db.collection<ApprovalDocument>("approvals").updateOne(
      { returnId, processedAt: null },
      {
        $set: {
          processedAt: now,
          providerReference: `refund-${returnId}`,
        },
      },
    );
    await db.collection<HistoryDocument>("returnHistory").updateOne(
      { returnId, eventKey: "refund-processed" },
      {
        $setOnInsert: {
          _id: `history:${returnId}:refund-processed`,
          returnId,
          eventKey: "refund-processed",
          eventType: "refund.processed",
          occurredAt: now,
          metadata: { providerReference: `refund-${returnId}` },
        },
      },
      { upsert: true },
    );
  });

  return agenda;
}
