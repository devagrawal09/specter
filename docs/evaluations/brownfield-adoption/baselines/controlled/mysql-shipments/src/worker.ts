import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { createNotificationWorker } from "./queue.js";

const config = loadConfig();
const pool = createPool(config);
const resources = createNotificationWorker(config, pool);
let stopping = false;

resources.worker.on("completed", (job) => console.log(JSON.stringify({ event: "notification-completed", jobId: job.id })));
resources.worker.on("failed", (job, error) => console.error(JSON.stringify({ event: "notification-failed", jobId: job?.id, message: error.message })));

async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ event: "worker-shutdown", signal }));
  await resources.worker.close();
  resources.redis.disconnect();
  await pool.end();
}

process.on("SIGINT", () => void stop("SIGINT").then(() => process.exit(0)));
process.on("SIGTERM", () => void stop("SIGTERM").then(() => process.exit(0)));
console.log(JSON.stringify({ event: "worker-started" }));
