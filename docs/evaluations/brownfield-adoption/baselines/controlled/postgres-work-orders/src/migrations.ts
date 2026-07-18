import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';

interface MigrationFile {
  version: number;
  name: string;
  upPath: string;
  downPath: string;
  checksum: string;
  upSql: string;
}

async function discoverMigrations(directory: string): Promise<MigrationFile[]> {
  const names = await fs.readdir(directory);
  const upNames = names.filter((name) => /^[0-9]{3}_.+\.up\.sql$/.test(name)).sort();
  return Promise.all(
    upNames.map(async (name) => {
      const match = /^(?<version>[0-9]{3})_(?<name>.+)\.up\.sql$/.exec(name);
      if (match?.groups === undefined) throw new Error(`Invalid migration filename: ${name}`);
      const upPath = path.join(directory, name);
      const downPath = path.join(directory, name.replace(/\.up\.sql$/, '.down.sql'));
      await fs.access(downPath);
      const upSql = await fs.readFile(upPath, 'utf8');
      return {
        version: Number(match.groups.version),
        name: match.groups.name!,
        upPath,
        downPath,
        upSql,
        checksum: createHash('sha256').update(upSql).digest('hex'),
      };
    }),
  );
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_schema_migrations (
      version integer PRIMARY KEY,
      name text NOT NULL,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function migrate(
  pool: Pool,
  direction: 'up' | 'down',
  directory = path.join(process.cwd(), 'migrations'),
): Promise<string[]> {
  const migrations = await discoverMigrations(directory);
  const client = await pool.connect();
  const completed: string[] = [];
  try {
    await client.query(`SELECT pg_advisory_lock(hashtext('postgres-work-orders-migrations'))`);
    await ensureMigrationTable(client);
    const appliedResult = await client.query<{ version: number; checksum: string }>(
      'SELECT version, checksum FROM app_schema_migrations ORDER BY version',
    );
    const applied = new Map(appliedResult.rows.map((row) => [row.version, row.checksum]));

    for (const migration of migrations) {
      const recordedChecksum = applied.get(migration.version);
      if (recordedChecksum !== undefined && recordedChecksum !== migration.checksum) {
        throw new Error(`Checksum mismatch for applied migration ${migration.version}`);
      }
    }

    if (direction === 'up') {
      for (const migration of migrations) {
        if (applied.has(migration.version)) continue;
        await client.query('BEGIN');
        try {
          await client.query(migration.upSql);
          await client.query(
            `INSERT INTO app_schema_migrations (version, name, checksum) VALUES ($1, $2, $3)`,
            [migration.version, migration.name, migration.checksum],
          );
          await client.query('COMMIT');
          completed.push(`up ${migration.version.toString().padStart(3, '0')}_${migration.name}`);
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
    } else {
      const latest = [...migrations].reverse().find((migration) => applied.has(migration.version));
      if (latest !== undefined) {
        const downSql = await fs.readFile(latest.downPath, 'utf8');
        await client.query('BEGIN');
        try {
          await client.query(downSql);
          await client.query('DELETE FROM app_schema_migrations WHERE version = $1', [latest.version]);
          await client.query('COMMIT');
          completed.push(`down ${latest.version.toString().padStart(3, '0')}_${latest.name}`);
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
    }
    return completed;
  } finally {
    await client.query(`SELECT pg_advisory_unlock(hashtext('postgres-work-orders-migrations'))`);
    client.release();
  }
}
