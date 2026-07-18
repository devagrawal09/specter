import { serve, type ServerType } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool, pingDatabase } from "./db.js";
import { createQueueResources, pingRedis } from "./queue.js";
import { MysqlShipmentStore } from "./repository.js";
import { DefaultShipmentService } from "./service.js";
import { shutdownRuntime } from "./runtime.js";

const config = loadConfig();
const pool = createPool(config);
const queueResources = createQueueResources(config);
const service = new DefaultShipmentService(new MysqlShipmentStore(pool), pool, queueResources.queue);
const app = createApp({
  service,
  readiness: async () => {
    await Promise.all([pingDatabase(pool), pingRedis(config)]);
    return { mysql: "up", redis: "up" };
  }
});

let server: ServerType | undefined;
let stopping = false;

async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ event: "shutdown", signal }));
  await shutdownRuntime(server, pool, queueResources);
}

process.on("SIGTERM", () => void stop("SIGTERM").then(() => process.exit(0)));
process.on("SIGINT", () => void stop("SIGINT").then(() => process.exit(0)));

server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(JSON.stringify({ event: "listening", port: info.port }));
});
server.on("error", (error) => {
  console.error(JSON.stringify({ event: "server-error", message: error.message }));
  void stop("server-error").then(() => process.exit(1));
});
