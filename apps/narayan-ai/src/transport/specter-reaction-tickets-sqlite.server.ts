import type { Client } from '@libsql/client'
import {
  createSqliteDatabaseContext,
  type SqliteConnection,
  type SqliteDatabaseContext,
} from '@specter-ts/sqlite'
import { Effect } from 'effect'

import type {
  SettledReaction,
  SpecterReactionRecovery,
  SpecterReactionTicketStore,
} from './specter-http.server'

export async function prepareSqliteReactionTicketStore(client: Client) {
  await client.batch(
    [
      `CREATE TABLE IF NOT EXISTS specter_reaction_tickets (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
        envelope_json TEXT NOT NULL,
        options_json TEXT NOT NULL,
        error_json TEXT,
        expires_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS specter_reaction_tickets_expiry_idx
        ON specter_reaction_tickets(expires_at)`,
    ],
    'write',
  )

  const columns = await client.execute(
    'PRAGMA table_info(specter_reaction_tickets)',
  )
  if (!columns.rows.some((row) => row.name === 'envelope_json')) {
    await client.execute(
      `ALTER TABLE specter_reaction_tickets
        ADD COLUMN envelope_json TEXT NOT NULL DEFAULT 'null'`,
    )
  }
  if (!columns.rows.some((row) => row.name === 'options_json')) {
    await client.execute(
      `ALTER TABLE specter_reaction_tickets
        ADD COLUMN options_json TEXT NOT NULL DEFAULT '{}'`,
    )
  }
}

export function createSqliteReactionTicketStore(
  client: Client,
  options: { readonly context?: SqliteDatabaseContext } = {},
): SpecterReactionTicketStore {
  const context = options.context ?? createSqliteDatabaseContext(client)

  async function prune(connection: SqliteConnection) {
    await connection.execute({
      sql: 'DELETE FROM specter_reaction_tickets WHERE expires_at <= ?',
      args: [new Date().toISOString()],
    })
  }

  function runTransaction<A>(
    run: (connection: SqliteConnection) => Promise<A>,
  ): Promise<A> {
    return Effect.runPromise(
      context.transaction((connection) =>
        Effect.promise(() => run(connection)),
      ),
    )
  }

  return {
    async create(reactionId, expiresAt, recovery) {
      await runTransaction(async (connection) => {
        await prune(connection)
        await connection.execute({
          sql: `INSERT INTO specter_reaction_tickets (
              id,
              status,
              envelope_json,
              options_json,
              error_json,
              expires_at
            ) VALUES (?, 'pending', ?, ?, NULL, ?)`,
          args: [
            reactionId,
            JSON.stringify(recovery.envelope),
            JSON.stringify(recovery.options),
            expiresAt.toISOString(),
          ],
        })
      })
    },

    async settle(reactionId, result) {
      await runTransaction(async (connection) => {
        await connection.execute({
          sql: `UPDATE specter_reaction_tickets
            SET status = ?, error_json = ?
            WHERE id = ?`,
          args: [
            result.ok ? 'succeeded' : 'failed',
            result.ok ? null : JSON.stringify(result.error),
            reactionId,
          ],
        })
      })
    },

    async get(reactionId) {
      const result = await runTransaction((connection) =>
        connection.execute({
          sql: `SELECT status, envelope_json, options_json, error_json
            FROM specter_reaction_tickets
            WHERE id = ? AND expires_at > ?`,
          args: [reactionId, new Date().toISOString()],
        }),
      )
      const row = result.rows[0]
      if (!row) return undefined
      if (row.status === 'succeeded') {
        return { status: 'settled', result: { ok: true } }
      }
      if (row.status === 'failed') {
        if (typeof row.error_json !== 'string') {
          throw new Error('Failed Reaction ticket is missing its error')
        }
        return {
          status: 'settled',
          result: {
            ok: false,
            error: JSON.parse(row.error_json) as Extract<
              SettledReaction,
              { ok: false }
            >['error'],
          },
        }
      }
      if (
        typeof row.envelope_json !== 'string' ||
        typeof row.options_json !== 'string'
      ) {
        throw new Error('Pending Reaction ticket is missing recovery data')
      }
      return {
        status: 'pending',
        recovery: {
          envelope: JSON.parse(row.envelope_json),
          options: JSON.parse(
            row.options_json,
          ) as SpecterReactionRecovery['options'],
        },
      }
    },
  }
}
