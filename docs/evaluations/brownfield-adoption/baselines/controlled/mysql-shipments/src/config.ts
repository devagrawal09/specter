import "dotenv/config";
import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().pipe(z.literal(42133)).default(42133),
  MYSQL_URL: z.string().url().default("mysql://shipments:shipments@127.0.0.1:42134/shipments"),
  REDIS_URL: z.string().url().default("redis://127.0.0.1:42135"),
  REDIS_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(50).max(10_000).default(750),
  RECONCILE_INTERVAL_MS: z.coerce.number().int().min(100).default(2000),
  RECONCILE_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50)
});

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  mysqlUrl: string;
  redisUrl: string;
  redisCommandTimeoutMs: number;
  reconcileIntervalMs: number;
  reconcileBatchSize: number;
};

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const value = environmentSchema.parse(source);
  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    mysqlUrl: value.MYSQL_URL,
    redisUrl: value.REDIS_URL,
    redisCommandTimeoutMs: value.REDIS_COMMAND_TIMEOUT_MS,
    reconcileIntervalMs: value.RECONCILE_INTERVAL_MS,
    reconcileBatchSize: value.RECONCILE_BATCH_SIZE
  };
}
