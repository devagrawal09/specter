import type { Client, Transaction } from '@libsql/client'
import { Effect, Exit, Semaphore } from 'effect'

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
  readonly serialize: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
  readonly transaction: <A, E, R>(
    run: (connection: SqliteConnection) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | SqliteDatabaseFailure, R>
}

export function createSqliteDatabaseContext(
  client: Client,
): SqliteDatabaseContext {
  const semaphore = Semaphore.makeUnsafe(1)

  return {
    client,
    serialize: semaphore.withPermit,
    transaction: (run) =>
      semaphore.withPermit(
        Effect.acquireUseRelease(
          Effect.tryPromise({
            try: () => client.transaction('write'),
            catch: (cause) => new SqliteDatabaseFailure('begin', cause),
          }),
          run,
          (transaction, exit) =>
            (Exit.isSuccess(exit)
              ? Effect.tryPromise({
                  try: () => transaction.commit(),
                  catch: (cause) => new SqliteDatabaseFailure('commit', cause),
                })
              : Effect.tryPromise({
                  try: () => transaction.rollback(),
                  catch: (cause) =>
                    new SqliteDatabaseFailure('rollback', cause),
                })
            ).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  transaction.close()
                }),
              ),
            ),
        ),
      ),
  }
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
