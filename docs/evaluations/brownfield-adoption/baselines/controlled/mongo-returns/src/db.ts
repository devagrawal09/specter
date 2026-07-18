import { Db, MongoClient } from "mongodb";
import { DATABASE_NAME } from "./config.js";

export interface DatabaseContext {
  client: MongoClient;
  db: Db;
}

export async function connectDatabase(uri: string): Promise<DatabaseContext> {
  const client = new MongoClient(uri, {
    appName: "mongo-returns-api",
    retryWrites: true,
    connectTimeoutMS: 1_000,
    serverSelectionTimeoutMS: 1_000,
    socketTimeoutMS: 1_000,
    heartbeatFrequencyMS: 500,
    minHeartbeatFrequencyMS: 100,
  });
  await client.connect();
  const db = client.db(DATABASE_NAME);
  await db.command({ ping: 1 });
  return { client, db };
}
