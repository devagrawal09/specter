import { pathToFileURL } from "node:url";
import { Db, ObjectId } from "mongodb";
import { AGENDA_COLLECTION, loadConfig } from "../src/config.js";
import { connectDatabase } from "../src/db.js";
import {
  AgendaJobDocument,
  ApprovalDocument,
  HistoryDocument,
  ReminderDocument,
  ReturnDocument,
} from "../src/domain/models.js";
import { REFUND_JOB, REMINDER_JOB } from "../src/repositories/job-repository.js";
import { runMigrations } from "./migrate.js";

export const SNAPSHOT_RETURN_IDS = [
  "ret-1001",
  "ret-1002",
  "ret-1003",
  "ret-1004",
  "ret-1005",
  "ret-1006",
] as const;
const SEED_OWNER = "mongo-returns-baseline";
const at = (value: string): Date => new Date(value);

const returns: ReturnDocument[] = [
  {
    _id: "ret-1001",
    orderId: "ord-5001",
    customerId: "cus-301",
    itemSku: "JACKET-NAVY-M",
    reason: "Sleeves are too short",
    status: "inspected",
    refundAmountCents: 12900,
    currency: "USD",
    receivedAt: at("2025-01-03T10:00:00.000Z"),
    inspectedAt: at("2025-01-03T14:00:00.000Z"),
    inspectionResult: "accepted",
    createdAt: at("2025-01-01T09:00:00.000Z"),
    updatedAt: at("2025-01-03T14:00:00.000Z"),
    version: 3,
  },
  {
    _id: "ret-1002",
    orderId: "ord-5002",
    customerId: "cus-302",
    itemSku: "SHOE-WHITE-9",
    reason: "Wrong size",
    status: "refunded",
    refundAmountCents: 8900,
    currency: "USD",
    receivedAt: at("2025-01-04T10:00:00.000Z"),
    inspectedAt: at("2025-01-04T12:00:00.000Z"),
    inspectionResult: "accepted",
    createdAt: at("2025-01-02T09:00:00.000Z"),
    updatedAt: at("2025-01-04T13:00:00.000Z"),
    version: 4,
  },
  {
    _id: "ret-1003",
    orderId: "ord-5003",
    customerId: "cus-303",
    itemSku: "MUG-GREEN",
    reason: "Changed mind",
    status: "requested",
    refundAmountCents: 2400,
    currency: "USD",
    receivedAt: null,
    inspectedAt: null,
    inspectionResult: null,
    createdAt: at("2025-01-05T09:00:00.000Z"),
    updatedAt: at("2025-01-05T09:00:00.000Z"),
    version: 1,
  },
  {
    _id: "ret-1004",
    orderId: "ord-5004",
    customerId: "cus-304",
    itemSku: "LAMP-DESK-BLK",
    reason: "Shade was scratched",
    status: "received",
    refundAmountCents: 6700,
    currency: "USD",
    receivedAt: at("2025-01-07T11:00:00.000Z"),
    inspectedAt: null,
    inspectionResult: null,
    createdAt: at("2025-01-06T09:00:00.000Z"),
    updatedAt: at("2025-01-07T11:00:00.000Z"),
    version: 2,
  },
  {
    _id: "ret-1005",
    orderId: "ord-5005",
    customerId: "cus-305",
    itemSku: "HEADPHONE-BLU",
    reason: "Intermittent audio",
    status: "rejected",
    refundAmountCents: 15900,
    currency: "USD",
    receivedAt: at("2025-01-08T10:00:00.000Z"),
    inspectedAt: at("2025-01-08T15:00:00.000Z"),
    inspectionResult: "rejected",
    createdAt: at("2025-01-07T09:00:00.000Z"),
    updatedAt: at("2025-01-08T15:00:00.000Z"),
    version: 3,
  },
  {
    _id: "ret-1006",
    orderId: "ord-5006",
    customerId: "cus-306",
    itemSku: "THROW-OCHRE",
    reason: "Color differs from listing",
    status: "inspected",
    refundAmountCents: 5400,
    currency: "USD",
    receivedAt: at("2025-01-10T10:00:00.000Z"),
    inspectedAt: at("2025-01-10T12:00:00.000Z"),
    inspectionResult: "accepted",
    createdAt: at("2025-01-09T09:00:00.000Z"),
    updatedAt: at("2025-01-10T12:00:00.000Z"),
    version: 3,
  },
];

const approval: ApprovalDocument = {
  _id: "approval:ret-1002",
  returnId: "ret-1002",
  amountCents: 8900,
  currency: "USD",
  approvedAt: at("2025-01-04T13:00:00.000Z"),
  processedAt: at("2025-01-04T13:01:00.000Z"),
  providerReference: "refund-ret-1002",
};

const reminder: ReminderDocument = {
  _id: "reminder:ret-1003",
  returnId: "ret-1003",
  dueAt: at("2035-01-06T09:00:00.000Z"),
  state: "scheduled",
  cancelledAt: null,
  sentAt: null,
};

const historySpecs: Array<[string, string, string, string, Record<string, unknown>]> = [
  ["ret-1001", "requested", "return.requested", "2025-01-01T09:00:00.000Z", {}],
  ["ret-1001", "received", "return.received", "2025-01-03T10:00:00.000Z", {}],
  ["ret-1001", "inspected", "return.inspected", "2025-01-03T14:00:00.000Z", { outcome: "accepted" }],
  ["ret-1002", "requested", "return.requested", "2025-01-02T09:00:00.000Z", {}],
  ["ret-1002", "received", "return.received", "2025-01-04T10:00:00.000Z", {}],
  ["ret-1002", "inspected", "return.inspected", "2025-01-04T12:00:00.000Z", { outcome: "accepted" }],
  ["ret-1002", "refund-approved", "refund.approved", "2025-01-04T13:00:00.000Z", { amountCents: 8900, currency: "USD" }],
  ["ret-1002", "refund-processed", "refund.processed", "2025-01-04T13:01:00.000Z", { providerReference: "refund-ret-1002" }],
  ["ret-1003", "requested", "return.requested", "2025-01-05T09:00:00.000Z", {}],
  ["ret-1004", "requested", "return.requested", "2025-01-06T09:00:00.000Z", {}],
  ["ret-1004", "received", "return.received", "2025-01-07T11:00:00.000Z", {}],
  ["ret-1005", "requested", "return.requested", "2025-01-07T09:00:00.000Z", {}],
  ["ret-1005", "received", "return.received", "2025-01-08T10:00:00.000Z", {}],
  ["ret-1005", "inspected", "return.inspected", "2025-01-08T15:00:00.000Z", { outcome: "rejected" }],
  ["ret-1006", "requested", "return.requested", "2025-01-09T09:00:00.000Z", {}],
  ["ret-1006", "received", "return.received", "2025-01-10T10:00:00.000Z", {}],
  ["ret-1006", "inspected", "return.inspected", "2025-01-10T12:00:00.000Z", { outcome: "accepted" }],
];

const histories: HistoryDocument[] = historySpecs.map(
  ([returnId, eventKey, eventType, occurredAt, metadata]) => ({
    _id: `history:${returnId}:${eventKey}`,
    returnId,
    eventKey,
    eventType,
    occurredAt: at(occurredAt),
    metadata,
  }),
);

const jobs: Array<AgendaJobDocument & { _id: ObjectId }> = [
  {
    _id: new ObjectId("64a000000000000000000002"),
    name: REFUND_JOB,
    data: { returnId: "ret-1002", idempotencyKey: "refund:ret-1002", seedOwner: SEED_OWNER },
    type: "normal",
    priority: 10,
    nextRunAt: null,
    lockedAt: null,
    disabled: false,
    lastRunAt: at("2025-01-04T13:01:00.000Z"),
    lastFinishedAt: at("2025-01-04T13:01:00.000Z"),
  },
  {
    _id: new ObjectId("64a000000000000000000003"),
    name: REMINDER_JOB,
    data: { returnId: "ret-1003", idempotencyKey: "reminder:ret-1003", seedOwner: SEED_OWNER },
    type: "normal",
    priority: 0,
    nextRunAt: at("2035-01-06T09:00:00.000Z"),
    lockedAt: null,
    disabled: false,
  },
];

export async function runSeed(db: Db): Promise<Record<string, unknown>> {
  await runMigrations(db);
  for (const document of returns) {
    await db.collection<ReturnDocument>("returns").replaceOne({ _id: document._id }, document, { upsert: true });
  }

  await db.collection<ApprovalDocument>("approvals").deleteMany({
    returnId: { $in: [...SNAPSHOT_RETURN_IDS] },
    _id: { $ne: approval._id },
  });
  await db.collection<ApprovalDocument>("approvals").replaceOne({ _id: approval._id }, approval, { upsert: true });

  await db.collection<ReminderDocument>("reminders").deleteMany({
    returnId: { $in: [...SNAPSHOT_RETURN_IDS] },
    _id: { $ne: reminder._id },
  });
  await db.collection<ReminderDocument>("reminders").replaceOne({ _id: reminder._id }, reminder, { upsert: true });

  const historyIds = histories.map((document) => document._id);
  await db.collection<HistoryDocument>("returnHistory").deleteMany({
    returnId: { $in: [...SNAPSHOT_RETURN_IDS] },
    _id: { $nin: historyIds },
  });
  for (const document of histories) {
    await db.collection<HistoryDocument>("returnHistory").replaceOne({ _id: document._id }, document, { upsert: true });
  }

  await db.collection<AgendaJobDocument>(AGENDA_COLLECTION).deleteMany({
    "data.returnId": { $in: [...SNAPSHOT_RETURN_IDS] },
  });
  for (const document of jobs) {
    await db.collection<AgendaJobDocument>(AGENDA_COLLECTION).insertOne(document);
  }

  return {
    returnIds: [...SNAPSHOT_RETURN_IDS],
    approvals: 1,
    reminders: 1,
    histories: histories.length,
    jobs: jobs.length,
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const database = await connectDatabase(config.mongodbUri);
  try {
    console.log(JSON.stringify({ ok: true, snapshot: await runSeed(database.db) }));
  } finally {
    await database.client.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
