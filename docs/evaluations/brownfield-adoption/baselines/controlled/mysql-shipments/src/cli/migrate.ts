import { loadConfig } from "../config.js";
import { createPool } from "../db.js";
import { runMigrations } from "../migrations.js";

const pool = createPool(loadConfig());
try {
  const applied = await runMigrations(pool);
  console.log(JSON.stringify({ ok: true, applied }));
} finally {
  await pool.end();
}
