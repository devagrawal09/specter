import "dotenv/config";

export const PUBLIC_PORT = 42132;
export const DATABASE_NAME = "mongo_returns";
export const AGENDA_COLLECTION = "agendaJobs";

export interface RuntimeConfig {
  mongodbUri: string;
  agendaProcessEveryMs: number;
}

export function loadConfig(): RuntimeConfig {
  const agendaProcessEveryMs = Number(process.env.AGENDA_PROCESS_EVERY_MS ?? "100");
  if (!Number.isInteger(agendaProcessEveryMs) || agendaProcessEveryMs < 25) {
    throw new Error("AGENDA_PROCESS_EVERY_MS must be an integer of at least 25");
  }

  return {
    mongodbUri:
      process.env.MONGODB_URI ??
      "mongodb://127.0.0.1:42133/mongo_returns?replicaSet=rs0&directConnection=true",
    agendaProcessEveryMs,
  };
}
