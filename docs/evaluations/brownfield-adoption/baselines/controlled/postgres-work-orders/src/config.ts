import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('true')
  .transform((value) => value === 'true');

const configSchema = z.object({
  PORT: z.coerce.number().int().pipe(z.literal(42131)).default(42131),
  HOST: z.string().min(1).default('127.0.0.1'),
  DATABASE_URL: z
    .string()
    .url()
    .default('postgres://work_orders:work_orders@127.0.0.1:55431/work_orders'),
  WORKER_ENABLED: booleanString,
  DISPATCH_INTERVAL_MS: z.coerce.number().int().min(50).max(60_000).default(250),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse(environment);
}
