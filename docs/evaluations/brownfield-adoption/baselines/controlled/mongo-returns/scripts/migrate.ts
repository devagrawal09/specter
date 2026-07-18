import { pathToFileURL } from "node:url";
import { Db } from "mongodb";
import { AGENDA_COLLECTION, loadConfig } from "../src/config.js";
import { connectDatabase } from "../src/db.js";

const COLLECTIONS = [
  "returns",
  "approvals",
  "reminders",
  "returnHistory",
  AGENDA_COLLECTION,
  "schemaMigrations",
] as const;

export async function runMigrations(db: Db): Promise<string[]> {
  const existing = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((collection) => collection.name),
  );
  for (const name of COLLECTIONS) {
    if (!existing.has(name)) await db.createCollection(name);
  }

  await db.collection("returns").createIndex({ orderId: 1 }, { unique: true, name: "uniq_order" });
  await db.collection("returns").createIndex({ status: 1, updatedAt: 1 }, { name: "status_updated" });
  await db.collection("approvals").createIndex({ returnId: 1 }, { unique: true, name: "uniq_return_approval" });
  await db.collection("reminders").createIndex({ returnId: 1 }, { unique: true, name: "uniq_return_reminder" });
  await db
    .collection("returnHistory")
    .createIndex({ returnId: 1, eventKey: 1 }, { unique: true, name: "uniq_return_event" });
  await db
    .collection("returnHistory")
    .createIndex({ returnId: 1, occurredAt: 1 }, { name: "return_timeline" });
  await db
    .collection(AGENDA_COLLECTION)
    .createIndex(
      { "data.idempotencyKey": 1 },
      { unique: true, sparse: true, name: "uniq_job_idempotency" },
    );
  await db
    .collection(AGENDA_COLLECTION)
    .createIndex(
      { name: 1, nextRunAt: 1, priority: -1, lockedAt: 1, disabled: 1 },
      { name: "findAndLockNextJobIndex" },
    );

  const appliedAt = new Date();
  const migrationIds = ["001_domain_collections", "002_transaction_and_agenda_indexes"];
  for (const migrationId of migrationIds) {
    await db.collection<{ _id: string; appliedAt: Date }>("schemaMigrations").updateOne(
      { _id: migrationId },
      { $setOnInsert: { _id: migrationId, appliedAt } },
      { upsert: true },
    );
  }
  return migrationIds;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const database = await connectDatabase(config.mongodbUri);
  try {
    const migrationIds = await runMigrations(database.db);
    console.log(JSON.stringify({ ok: true, migrations: migrationIds }));
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
