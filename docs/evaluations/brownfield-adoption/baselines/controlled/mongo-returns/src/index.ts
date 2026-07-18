import { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { Agenda } from "agenda";
import { ObjectId } from "mongodb";
import { createApp } from "./app.js";
import { AGENDA_COLLECTION, loadConfig, PUBLIC_PORT } from "./config.js";
import { connectDatabase } from "./db.js";
import { AgendaJobDocument } from "./domain/models.js";
import { createAgenda, READINESS_JOB } from "./jobs/agenda.js";
import { ReturnService } from "./services/return-service.js";

const DEPENDENCY_TIMEOUT_MS = 1_000;
const AGENDA_PROBE_TIMEOUT_MS = 3_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const database = await connectDatabase(config.mongodbUri);
  let agenda: Agenda | undefined;
  let agendaStarted = false;
  let agendaProved = false;
  let agendaStopping: Promise<void> | undefined;
  let agendaSupervisor: NodeJS.Timeout | undefined;
  let supervision: Promise<void> | undefined;
  let probe: { idempotencyKey: string; resolve: () => void } | undefined;
  let server: Server | undefined;
  let stopping = false;

  const app = createApp(new ReturnService(database.client, database.db), async () => {
    try {
      await database.db.command(
        { ping: 1, maxTimeMS: 500 },
        { signal: AbortSignal.timeout(DEPENDENCY_TIMEOUT_MS) },
      );
    } catch (error) {
      agendaProved = false;
      void stopAgenda();
      throw error;
    }
    if (!agendaStarted || !agendaProved) throw new Error("Agenda is not ready");
  });

  const closeServer = async (): Promise<void> => {
    if (server === undefined || !server.listening) return;
    await new Promise<void>((resolve, reject) =>
      server?.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  };

  const stopAgenda = (): Promise<void> => {
    if (agendaStopping !== undefined) return agendaStopping;
    agendaStarted = false;
    agendaProved = false;
    const current = agenda;
    agenda = undefined;
    agendaStopping = (current === undefined ? Promise.resolve() : current.stop().catch(() => undefined)).finally(() => {
      agendaStopping = undefined;
    });
    return agendaStopping;
  };

  database.client.on("serverHeartbeatFailed", () => {
    void stopAgenda();
  });

  const proveAgenda = async (): Promise<void> => {
    if (!agendaStarted || agenda === undefined) throw new Error("Agenda is not started");
    if (probe !== undefined) throw new Error("Agenda readiness probe is already running");

    const idempotencyKey = `readiness:${randomUUID()}`;
    const completed = new Promise<void>((resolve) => {
      probe = { idempotencyKey, resolve };
    });
    try {
      await database.db.collection<AgendaJobDocument>(AGENDA_COLLECTION).insertOne({
        _id: new ObjectId(),
        name: READINESS_JOB,
        data: { returnId: "__readiness__", idempotencyKey },
        type: "normal",
        priority: 20,
        nextRunAt: new Date(),
        lockedAt: null,
        disabled: false,
      });
      let timeout: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          completed,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Agenda readiness probe timed out")),
              AGENDA_PROBE_TIMEOUT_MS,
            );
          }),
        ]);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
      }
      agendaProved = true;
      console.log(JSON.stringify({ event: "agenda-readiness-proved" }));
    } finally {
      probe = undefined;
      await database.db
        .collection<AgendaJobDocument>(AGENDA_COLLECTION)
        .deleteMany({ "data.idempotencyKey": idempotencyKey })
        .catch(() => undefined);
    }
  };

  const startAgenda = async (): Promise<void> => {
    await agendaStopping;
    if (stopping || agendaStarted) return;
    const candidate = createAgenda(config.mongodbUri, database.db, config.agendaProcessEveryMs, (idempotencyKey) => {
      if (agenda === candidate && probe?.idempotencyKey === idempotencyKey) probe.resolve();
    });
    candidate.on("error", (error) => {
      if (agenda === candidate) {
        void stopAgenda();
      }
      console.error("agenda error", error);
    });
    try {
      await candidate.start();
      if (stopping) {
        await candidate.stop().catch(() => undefined);
        return;
      }
      agenda = candidate;
      agendaStarted = true;
      await proveAgenda();
    } catch (error) {
      await candidate.stop().catch(() => undefined);
      if (agenda === candidate) agenda = undefined;
      agendaStarted = false;
      agendaProved = false;
      throw error;
    }
  };

  const superviseAgenda = (): Promise<void> => {
    if (supervision !== undefined) return supervision;
    supervision = (async () => {
      if (stopping) return;
      try {
        await database.db.command(
          { ping: 1, maxTimeMS: 500 },
          { signal: AbortSignal.timeout(DEPENDENCY_TIMEOUT_MS) },
        );
      } catch {
        await stopAgenda();
        return;
      }
      try {
        if (!agendaStarted) await startAgenda();
        else if (!agendaProved) await proveAgenda();
      } catch {
        await stopAgenda();
      }
    })().finally(() => {
      supervision = undefined;
    });
    return supervision;
  };

  const stop = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.log(`received ${signal}; shutting down`);
    if (agendaSupervisor !== undefined) clearInterval(agendaSupervisor);
    await supervision?.catch(() => undefined);
    await closeServer();
    await stopAgenda();
    await database.client.close();
  };

  const stopForSignal = (signal: string): void => {
    void stop(signal).then(
      () => process.exit(0),
      (error: unknown) => {
        console.error("shutdown failed", error);
        process.exit(1);
      },
    );
  };
  process.once("SIGINT", () => stopForSignal("SIGINT"));
  process.once("SIGTERM", () => stopForSignal("SIGTERM"));

  try {
    // Bind first. A doomed EADDRINUSE process must never start Agenda and lock jobs.
    server = app.listen(PUBLIC_PORT, "0.0.0.0");
    await new Promise<void>((resolve, reject) => {
      server?.once("listening", resolve);
      server?.once("error", reject);
    });
    await startAgenda();
    agendaSupervisor = setInterval(() => void superviseAgenda(), 250);
    agendaSupervisor.unref();
  } catch (error) {
    await stop("startup-failure");
    throw error;
  }
  console.log(`returns API listening on ${PUBLIC_PORT}`);
}

main().catch((error: unknown) => {
  console.error("fatal startup error", error);
  process.exitCode = 1;
});
