import { execFile, spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import request from "supertest";
import { Agenda } from "agenda";
import { ObjectId } from "mongodb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/migrate.js";
import { runSeed, SNAPSHOT_RETURN_IDS } from "../../scripts/seed.js";
import { createApp } from "../../src/app.js";
import { AGENDA_COLLECTION, loadConfig } from "../../src/config.js";
import { connectDatabase, DatabaseContext } from "../../src/db.js";
import { AgendaJobDocument, ApprovalDocument, HistoryDocument, ReturnDocument } from "../../src/domain/models.js";
import { AppError } from "../../src/errors.js";
import { createAgenda } from "../../src/jobs/agenda.js";
import { REFUND_JOB } from "../../src/repositories/job-repository.js";
import { ReturnService } from "../../src/services/return-service.js";

const liveDescribe = process.env.RUN_LIVE_TESTS === "1" ? describe : describe.skip;
const config = loadConfig();
let database: DatabaseContext;
let service: ReturnService;
let runningAgenda: Agenda | undefined;
let runtimeServer: ChildProcessWithoutNullStreams | undefined;
let runtimeOutput = "";
let mongoStopped = false;
const liveReturnIds = ["ret-restart-proof", "ret-stale-lock-proof", "ret-runtime-recovery-proof"];
const execFileAsync = promisify(execFile);

async function waitUntil(check: () => Promise<boolean>, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("timed out waiting for durable job execution");
}

async function compose(...args: string[]): Promise<void> {
  await execFileAsync("docker", ["compose", ...args], { cwd: process.cwd(), timeout: 20_000 });
}

async function stopRuntimeServer(): Promise<void> {
  const child = runtimeServer;
  runtimeServer = undefined;
  if (child === undefined || child.exitCode !== null) return;
  child.kill("SIGINT");
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (child.exitCode === null) child.kill("SIGTERM");
}

liveDescribe("replica-set transactions and durable jobs", () => {
  beforeAll(async () => {
    database = await connectDatabase(config.mongodbUri);
    await runMigrations(database.db);
  });

  beforeEach(async () => {
    await runSeed(database.db);
    service = new ReturnService(database.client, database.db, () => new Date("2025-02-01T12:00:00.000Z"));
  });

  afterEach(async () => {
    if (mongoStopped) {
      await compose("start", "--wait", "mongo");
      mongoStopped = false;
    }
    await stopRuntimeServer();
    if (runningAgenda !== undefined) {
      await runningAgenda.stop();
      runningAgenda = undefined;
    }
    await database.db.collection(AGENDA_COLLECTION).deleteMany({ "data.returnId": { $in: liveReturnIds } });
    await database.db.collection("approvals").deleteMany({ returnId: { $in: liveReturnIds } });
    await database.db.collection("reminders").deleteMany({ returnId: { $in: liveReturnIds } });
    await database.db.collection("returnHistory").deleteMany({ returnId: { $in: liveReturnIds } });
    await database.db.collection<ReturnDocument>("returns").deleteMany({ _id: { $in: liveReturnIds } });
    await runSeed(database.db);
  });

  afterAll(async () => {
    await database.client.close();
  });

  it("reconciles the same deterministic baseline on repeated seeds", async () => {
    const first = await runSeed(database.db);
    const second = await runSeed(database.db);
    expect(second).toEqual(first);
    expect(await database.db.collection<ReturnDocument>("returns").countDocuments({ _id: { $in: [...SNAPSHOT_RETURN_IDS] } })).toBe(6);
    expect(await database.db.collection("approvals").countDocuments({ returnId: { $in: [...SNAPSHOT_RETURN_IDS] } })).toBe(1);
    expect(await database.db.collection("reminders").countDocuments({ returnId: { $in: [...SNAPSHOT_RETURN_IDS] } })).toBe(1);
    expect(await database.db.collection("returnHistory").countDocuments({ returnId: { $in: [...SNAPSHOT_RETURN_IDS] } })).toBe(17);
    expect(await database.db.collection("returns").countDocuments({})).toBe(6);
    expect(await database.db.collection(AGENDA_COLLECTION).countDocuments({})).toBe(2);
  });

  it("keeps legacy readers stable for the seeded state matrix", async () => {
    const response = await request(createApp(service)).get("/returns").expect(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.data.returns.map((item: { id: string; status: string }) => [item.id, item.status])).toEqual([
      ["ret-1001", "inspected"],
      ["ret-1002", "refunded"],
      ["ret-1003", "requested"],
      ["ret-1004", "received"],
      ["ret-1005", "rejected"],
      ["ret-1006", "inspected"],
    ]);
  });

  it("atomically approves eligible state and rejects invalid or repeated transitions", async () => {
    const app = createApp(service);
    const approved = await request(app).post("/returns/ret-1001/approve-refund").send({}).expect(200);
    expect(approved.body.data.return.status).toBe("refunded");
    expect(approved.body.data.approval.id).toBe("approval:ret-1001");
    expect(await database.db.collection("approvals").countDocuments({ returnId: "ret-1001" })).toBe(1);
    expect(await database.db.collection("returnHistory").countDocuments({ returnId: "ret-1001", eventKey: "refund-approved" })).toBe(1);
    expect(await database.db.collection(AGENDA_COLLECTION).countDocuments({ "data.idempotencyKey": "refund:ret-1001" })).toBe(1);

    const repeated = await request(app).post("/returns/ret-1001/approve-refund").send({}).expect(409);
    expect(repeated.body.error.code).toBe("REFUND_ALREADY_APPROVED");
    const notReceived = await request(app).post("/returns/ret-1003/approve-refund").send({}).expect(409);
    expect(notReceived.body.error.code).toBe("RETURN_NOT_RECEIVED");
    const notInspected = await request(app).post("/returns/ret-1004/approve-refund").send({}).expect(409);
    expect(notInspected.body.error.code).toBe("RETURN_NOT_INSPECTED");
    const rejected = await request(app).post("/returns/ret-1005/approve-refund").send({}).expect(409);
    expect(rejected.body.error.code).toBe("INSPECTION_REJECTED");
    expect(await database.db.collection("approvals").countDocuments({ returnId: { $in: ["ret-1003", "ret-1004", "ret-1005"] } })).toBe(0);
    expect(await database.db.collection("returnHistory").countDocuments({ returnId: { $in: ["ret-1003", "ret-1004", "ret-1005"] }, eventKey: "refund-approved" })).toBe(0);
    expect(await database.db.collection(AGENDA_COLLECTION).countDocuments({ "data.idempotencyKey": { $in: ["refund:ret-1003", "refund:ret-1004", "refund:ret-1005"] } })).toBe(0);
  });

  it("commits exactly one approval under concurrent requests", async () => {
    const outcomes = await Promise.allSettled([
      service.approveRefund("ret-1006"),
      service.approveRefund("ret-1006"),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected).toBeDefined();
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(AppError);
    expect(await database.db.collection("approvals").countDocuments({ returnId: "ret-1006" })).toBe(1);
    expect(await database.db.collection("returnHistory").countDocuments({ returnId: "ret-1006", eventKey: "refund-approved" })).toBe(1);
    expect(await database.db.collection(AGENDA_COLLECTION).countDocuments({ "data.idempotencyKey": "refund:ret-1006" })).toBe(1);
  });

  it("executes the refund job and remains idempotent", async () => {
    await service.approveRefund("ret-1001");
    runningAgenda = createAgenda(config.mongodbUri, database.db, 50);
    await runningAgenda.start();
    await waitUntil(async () => {
      const approval = await database.db.collection<ApprovalDocument>("approvals").findOne({ returnId: "ret-1001" });
      return approval !== null && approval.processedAt !== null;
    });
    const approval = await database.db.collection<ApprovalDocument>("approvals").findOne({ returnId: "ret-1001" });
    expect(approval?.providerReference).toBe("refund-ret-1001");
    expect(await database.db.collection<HistoryDocument>("returnHistory").countDocuments({ returnId: "ret-1001", eventKey: "refund-processed" })).toBe(1);
    await runningAgenda.stop();
    runningAgenda = undefined;
  });

  it("runs a persisted due job after a worker restart", async () => {
    const returnId = "ret-restart-proof";
    const now = new Date();
    const dueAt = new Date(now.getTime() + 500);
    await database.db.collection<ReturnDocument>("returns").deleteOne({ _id: returnId });
    await database.db.collection<ApprovalDocument>("approvals").deleteOne({ returnId });
    await database.db.collection<HistoryDocument>("returnHistory").deleteMany({ returnId });
    await database.db.collection<AgendaJobDocument>(AGENDA_COLLECTION).deleteMany({ "data.idempotencyKey": `refund:${returnId}` });
    await database.db.collection<ReturnDocument>("returns").insertOne({
      _id: returnId,
      orderId: "ord-restart-proof",
      customerId: "cus-restart-proof",
      itemSku: "SKU-RESTART",
      reason: "restart test",
      status: "refunded",
      refundAmountCents: 100,
      currency: "USD",
      receivedAt: now,
      inspectedAt: now,
      inspectionResult: "accepted",
      createdAt: now,
      updatedAt: now,
      version: 4,
    });
    await database.db.collection<ApprovalDocument>("approvals").insertOne({
      _id: `approval:${returnId}`,
      returnId,
      amountCents: 100,
      currency: "USD",
      approvedAt: now,
      processedAt: null,
      providerReference: null,
    });
    await database.db.collection<AgendaJobDocument>(AGENDA_COLLECTION).insertOne({
      _id: new ObjectId(),
      name: REFUND_JOB,
      data: { returnId, idempotencyKey: `refund:${returnId}` },
      type: "normal",
      priority: 10,
      nextRunAt: dueAt,
      lockedAt: null,
      disabled: false,
    });

    const firstWorker = createAgenda(config.mongodbUri, database.db, 50);
    await firstWorker.start();
    await firstWorker.stop();
    expect((await database.db.collection<ApprovalDocument>("approvals").findOne({ returnId }))?.processedAt).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 600));
    const restartedWorker = createAgenda(config.mongodbUri, database.db, 50);
    runningAgenda = restartedWorker;
    await restartedWorker.start();
    await waitUntil(async () => {
      const approval = await database.db.collection<ApprovalDocument>("approvals").findOne({ returnId });
      return approval !== null && approval.processedAt !== null;
    });
    expect((await database.db.collection<ApprovalDocument>("approvals").findOne({ returnId }))?.providerReference).toBe(`refund-${returnId}`);
    await restartedWorker.stop();
    runningAgenda = undefined;
  });

  it("recovers a stale lock left by a failed worker and executes the due job", async () => {
    const returnId = "ret-stale-lock-proof";
    const now = new Date();
    await database.db.collection<ReturnDocument>("returns").insertOne({
      _id: returnId,
      orderId: "ord-stale-lock-proof",
      customerId: "cus-stale-lock-proof",
      itemSku: "SKU-STALE-LOCK",
      reason: "stale lock test",
      status: "refunded",
      refundAmountCents: 200,
      currency: "USD",
      receivedAt: now,
      inspectedAt: now,
      inspectionResult: "accepted",
      createdAt: now,
      updatedAt: now,
      version: 4,
    });
    await database.db.collection<ApprovalDocument>("approvals").insertOne({
      _id: `approval:${returnId}`,
      returnId,
      amountCents: 200,
      currency: "USD",
      approvedAt: now,
      processedAt: null,
      providerReference: null,
    });
    await database.db.collection<AgendaJobDocument>(AGENDA_COLLECTION).insertOne({
      _id: new ObjectId(),
      name: REFUND_JOB,
      data: { returnId, idempotencyKey: `refund:${returnId}` },
      type: "normal",
      priority: 10,
      nextRunAt: new Date(now.getTime() - 5_000),
      lockedAt: new Date(now.getTime() - 5_000),
      disabled: false,
    });

    runningAgenda = createAgenda(config.mongodbUri, database.db, 50);
    await runningAgenda.start();
    await waitUntil(async () => {
      const approval = await database.db.collection<ApprovalDocument>("approvals").findOne({ returnId });
      return approval !== null && approval.processedAt !== null;
    });
    expect((await database.db.collection<ApprovalDocument>("approvals").findOne({ returnId }))?.providerReference).toBe(`refund-${returnId}`);
  });

  it("stays unready through a full MongoDB outage and promptly executes new work after restart", async () => {
    const returnId = "ret-runtime-recovery-proof";
    const now = new Date();
    await database.db.collection<ReturnDocument>("returns").insertOne({
      _id: returnId,
      orderId: "ord-runtime-recovery-proof",
      customerId: "cus-runtime-recovery-proof",
      itemSku: "SKU-RUNTIME-RECOVERY",
      reason: "runtime recovery test",
      status: "inspected",
      refundAmountCents: 300,
      currency: "USD",
      receivedAt: now,
      inspectedAt: now,
      inspectionResult: "accepted",
      createdAt: now,
      updatedAt: now,
      version: 3,
    });
    runtimeOutput = "";
    runtimeServer = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, AGENDA_PROCESS_EVERY_MS: "50" },
      stdio: "pipe",
    });
    runtimeServer.stdout.on("data", (chunk: Buffer) => {
      runtimeOutput += chunk.toString();
    });
    runtimeServer.stderr.on("data", (chunk: Buffer) => {
      runtimeOutput += chunk.toString();
    });

    await waitUntil(async () => runtimeOutput.includes("returns API listening on 42132"));
    await waitUntil(async () => (await fetch("http://127.0.0.1:42132/health")).status === 200);
    const startupProofs = runtimeOutput.match(/agenda-readiness-proved/g)?.length ?? 0;
    expect(startupProofs).toBe(1);

    await compose("stop", "mongo");
    mongoStopped = true;
    await waitUntil(async () => (await fetch("http://127.0.0.1:42132/health")).status === 503);
    expect(runtimeOutput.match(/agenda-readiness-proved/g)?.length ?? 0).toBe(startupProofs);

    await compose("start", "--wait", "mongo");
    mongoStopped = false;
    await waitUntil(async () => (await fetch("http://127.0.0.1:42132/health")).status === 200);
    expect(runtimeOutput.match(/agenda-readiness-proved/g)?.length ?? 0).toBeGreaterThan(startupProofs);

    const acceptedAt = Date.now();
    const response = await fetch(`http://127.0.0.1:42132/returns/${returnId}/approve-refund`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(200);
    await waitUntil(async () => {
      const approval = await database.db.collection<ApprovalDocument>("approvals").findOne({ returnId });
      return approval !== null && approval.processedAt !== null;
    }, 3_000);
    expect(Date.now() - acceptedAt).toBeLessThan(3_000);
  }, 30_000);
});
