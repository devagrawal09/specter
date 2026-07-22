import type { Client, Transaction } from '@libsql/client'
import { Context, Effect, Exit, Option, Semaphore } from 'effect'

export type SqliteConnection = Client | Transaction

export class SqliteDatabaseFailure extends Error {
  readonly _tag = 'SqliteDatabaseFailure' as const

  constructor(
    readonly operation: 'begin' | 'commit' | 'rollback',
    readonly cause: unknown,
  ) {
    super(`SQLite ${operation} failed.`, { cause })
    this.name = 'SqliteDatabaseFailure'
  }
}

export type SqliteDatabaseContext = {
  readonly client: Client
  readonly use: <A, E, R>(
    run: (connection: SqliteConnection) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
  readonly serialize: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
  readonly transaction: <A, E, R>(
    run: (connection: SqliteConnection) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | SqliteDatabaseFailure, R>
}

type ActiveSqliteTransaction = {
  readonly owner: object
  readonly connection: SqliteConnection
  active: boolean
}

const ActiveSqliteTransaction = Context.Service<ActiveSqliteTransaction>(
  '@specter-ts/sqlite/ActiveTransaction',
)

export function createSqliteDatabaseContext(
  client: Client,
): SqliteDatabaseContext {
  const semaphore = Semaphore.makeUnsafe(1)
  const owner = {}

  const activeConnection = Effect.contextWith<
    never,
    SqliteConnection,
    never,
    never
  >((services) => {
    const active = Context.getOption(services, ActiveSqliteTransaction)
    return Effect.succeed(
      Option.isSome(active) &&
        active.value.owner === owner &&
        active.value.active
        ? active.value.connection
        : client,
    )
  })

  const context: SqliteDatabaseContext = {
    client,
    use: (run) => Effect.flatMap(activeConnection, run),
    serialize: (effect) =>
      Effect.flatMap(activeConnection, (active) =>
        active !== client ? effect : semaphore.withPermit(effect),
      ),
    transaction: (run) =>
      Effect.flatMap(activeConnection, (active) =>
        active !== client
          ? run(active)
          : semaphore.withPermit(
              Effect.acquireUseRelease(
                Effect.tryPromise({
                  try: async () => {
                    const connection = await client.transaction('write')
                    return {
                      connection,
                      active: { owner, connection, active: true },
                    }
                  },
                  catch: (cause) => new SqliteDatabaseFailure('begin', cause),
                }),
                ({ connection, active }) =>
                  run(connection).pipe(
                    Effect.provideService(ActiveSqliteTransaction, active),
                  ),
                ({ connection, active }, exit) =>
                  (Exit.isSuccess(exit)
                    ? Effect.tryPromise({
                        try: () => connection.commit(),
                        catch: (cause) =>
                          new SqliteDatabaseFailure('commit', cause),
                      })
                    : Effect.tryPromise({
                        try: () => connection.rollback(),
                        catch: (cause) =>
                          new SqliteDatabaseFailure('rollback', cause),
                      })
                  ).pipe(
                    Effect.ensuring(
                      Effect.sync(() => {
                        active.active = false
                        connection.close()
                      }),
                    ),
                  ),
              ),
            ),
      ),
  }

  return context
}

export function requireString(value: unknown, field: string) {
  if (typeof value !== 'string') {
    throw new Error(`Expected SQLite ${field} to be a string`)
  }
  return value
}

export function requireNumber(value: unknown, field: string) {
  const number = typeof value === 'bigint' ? Number(value) : value
  if (
    typeof number !== 'number' ||
    !Number.isSafeInteger(number) ||
    number < 0
  ) {
    throw new Error(`Expected SQLite ${field} to be a number`)
  }
  return number
}
