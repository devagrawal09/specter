import type { Pool } from "mysql2/promise";
import type { ServerType } from "@hono/node-server";
import type { QueueResources } from "./queue.js";
import { closeQueueResources } from "./queue.js";

export async function shutdownRuntime(server: ServerType | undefined, pool: Pool, queue: QueueResources): Promise<void> {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeQueueResources(queue);
  await pool.end();
}
