import { Context, Effect, Exit, Option, Semaphore } from 'effect'
import type { SqlClient, SqlError } from 'effect/sql'

/** A value a statement binds. */
export type SqliteValue = string | number | bigint | Uint8Array | null

/** One row a statement returns, by column name. */
export type SqliteRow = Readonly<Record<string, unknown>>

export class SqliteDatabaseFailure extends Error {
  readonly _tag = 'SqliteDatabaseFailure' as const

  constructor(
    readonly operation:
      | 'execute'
      | 'begin'
      | 'commit'
      | 'rollback'
      | 'transaction',
    readonly cause: unknown,
  ) {
    super(`SQLite ${operation} failed.`, { cause })
    this.name = 'SqliteDatabaseFailure'
  }
}

/**
 * The database Specter's SQLite stores run on: the host's connection, through
 * one of the drivers below or the host's own. Its transactions nest, so an
 * Event Log append, a Slice Store transaction, an outbox enqueue and the
 * host's own writes (its read models, through `use`) share one transaction
 * when they run inside it.
 *
 * `TConnection` is what the host's own queries run on, such as a libSQL
 * client for an ORM; Specter's stores only `execute`.
 */
export type SqliteDatabaseContext<TConnection = unknown> = {
  /**
   * Runs one statement and returns its rows: on the active transaction when
   * there is one, and otherwise on the database.
   */
  readonly execute: (
    sql: string,
    args?: readonly SqliteValue[],
  ) => Effect.Effect<readonly SqliteRow[], SqliteDatabaseFailure>
  /** Runs `run` with the connection a statement runs on now. */
  readonly use: <A, E, R>(
    run: (connection: TConnection) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
  /**
   * Runs `run` in one write transaction, committed when it succeeds and
   * rolled back when it fails, or inside the active one.
   */
  readonly transaction: <A, E, R>(
    run: (connection: TConnection) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | SqliteDatabaseFailure, R>
}

/** What Specter uses of a libSQL `Client` or `Transaction`. */
export type LibsqlConnection = {
  execute(statement: {
    readonly sql: string
    readonly args: SqliteValue[]
  }): Promise<{ readonly rows: readonly SqliteRow[] }>
}

/** What Specter uses of a libSQL `Client`. */
export type LibsqlClient = LibsqlConnection & {
  transaction(mode: 'write'): Promise<
    LibsqlConnection & {
      commit(): Promise<void>
      rollback(): Promise<void>
      close(): void
    }
  >
}

export type LibsqlDatabaseContext = SqliteDatabaseContext<LibsqlConnection> & {
  readonly client: LibsqlClient
}

type ActiveSqliteTransaction = {
  readonly owner: object
  readonly connection: LibsqlConnection
  active: boolean
}

const ActiveSqliteTransaction = Context.Service<ActiveSqliteTransaction>(
  '@specter-ts/sqlite/ActiveTransaction',
)

/**
 * The database over a libSQL client (`@libsql/client`). Transactions are
 * serialized in the process and nest by joining the active one; `use` gives
 * the host the libSQL connection a statement runs on now, for its own
 * queries.
 */
export function createSqliteDatabaseContext(
  client: LibsqlClient,
): LibsqlDatabaseContext {
  const semaphore = Semaphore.makeUnsafe(1)
  const owner = {}

  const activeConnection = Effect.contextWith<
    never,
    LibsqlConnection,
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

  const use: LibsqlDatabaseContext['use'] = (run) =>
    Effect.flatMap(activeConnection, run)

  return {
    client,
    execute: (sql, args = []) =>
      use((connection) =>
        Effect.tryPromise({
          try: async () =>
            (await connection.execute({ sql, args: [...args] })).rows,
          catch: (cause) => new SqliteDatabaseFailure('execute', cause),
        }),
      ),
    use,
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
}

export type SqlClientDatabaseOptions = {
  /**
   * Runs an Effect in one write transaction, joining the active one, such as
   * the host ORM's own transaction (Drizzle's `db.transaction(() => effect,
   * { behavior: 'immediate' })`). Statements inside it run on its
   * connection. Defaults to `sql.withTransaction`, which begins a deferred
   * transaction and nests with savepoints: begin it immediately instead when
   * several processes write the database.
   */
  readonly transaction?: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | SqlError.SqlError, R>
}

/**
 * The database over an Effect `SqlClient` (`effect/sql`) on SQLite, such as
 * `@effect/sql-sqlite-bun`, `@effect/sql-sqlite-node` or the host's own.
 * Statements run through the client, so inside a transaction the client
 * knows, the host's or Specter's, they run on that transaction's
 * connection; `use` gives the host the client itself.
 */
export function createSqlClientDatabaseContext(
  sql: SqlClient.SqlClient,
  options: SqlClientDatabaseOptions = {},
): SqliteDatabaseContext<SqlClient.SqlClient> {
  const transaction = options.transaction ?? sql.withTransaction
  return {
    execute: (statement, args = []) =>
      sql
        .unsafe<Record<string, unknown>>(statement, [...args])
        .withoutTransform.pipe(
          Effect.mapError(
            (cause) => new SqliteDatabaseFailure('execute', cause),
          ),
        ),
    use: (run) => run(sql),
    transaction: (run) =>
      transaction(run(sql)).pipe(
        Effect.catchIf(isSqlError, (cause) =>
          Effect.fail(new SqliteDatabaseFailure('transaction', cause)),
        ),
      ),
  }
}

/** What Specter uses of a `node:sqlite` `DatabaseSync`. */
export type NodeSqliteDatabase = {
  exec(sql: string): void
  prepare(sql: string): {
    all(...params: SqliteValue[]): readonly SqliteRow[]
  }
}

type ActiveNodeSqliteTransaction = {
  readonly owner: object
  active: boolean
}

const ActiveNodeSqliteTransaction =
  Context.Service<ActiveNodeSqliteTransaction>(
    '@specter-ts/sqlite/ActiveNodeTransaction',
  )

/**
 * The database over one `node:sqlite` connection (`DatabaseSync`), which
 * the host opens and closes. It has one connection, so its transactions
 * (`BEGIN IMMEDIATE`) are serialized in the process and nest by joining the
 * active one, and a statement run outside a transaction waits for the
 * active one to end rather than run inside it. `use` gives the host the
 * `DatabaseSync`.
 */
export function createNodeSqliteDatabaseContext<
  TDatabase extends NodeSqliteDatabase,
>(database: TDatabase): SqliteDatabaseContext<TDatabase> {
  const semaphore = Semaphore.makeUnsafe(1)
  const owner = {}

  const inTransaction = Effect.contextWith<never, boolean, never, never>(
    (services) => {
      const active = Context.getOption(services, ActiveNodeSqliteTransaction)
      return Effect.succeed(
        Option.isSome(active) &&
          active.value.owner === owner &&
          active.value.active,
      )
    },
  )

  const exec = (
    sql: string,
    operation: 'begin' | 'commit' | 'rollback',
  ): Effect.Effect<void, SqliteDatabaseFailure> =>
    Effect.try({
      try: () => database.exec(sql),
      catch: (cause) => new SqliteDatabaseFailure(operation, cause),
    })

  const execute: SqliteDatabaseContext<TDatabase>['execute'] = (
    sql,
    args = [],
  ) => {
    const run = Effect.try({
      try: () => database.prepare(sql).all(...args),
      catch: (cause) => new SqliteDatabaseFailure('execute', cause),
    })
    return Effect.flatMap(inTransaction, (active) =>
      active ? run : semaphore.withPermit(run),
    )
  }

  return {
    execute,
    use: (run) => run(database),
    transaction: (run) =>
      Effect.flatMap(inTransaction, (active) =>
        active
          ? run(database)
          : semaphore.withPermit(
              Effect.acquireUseRelease(
                Effect.as(exec('BEGIN IMMEDIATE', 'begin'), {
                  owner,
                  active: true,
                }),
                (transaction) =>
                  run(database).pipe(
                    Effect.provideService(
                      ActiveNodeSqliteTransaction,
                      transaction,
                    ),
                  ),
                (transaction, exit) =>
                  (Exit.isSuccess(exit)
                    ? // A commit that fails leaves the transaction open:
                      // roll it back, and fail with the commit's error.
                      exec('COMMIT', 'commit').pipe(
                        Effect.tapError(() =>
                          Effect.ignore(exec('ROLLBACK', 'rollback')),
                        ),
                      )
                    : exec('ROLLBACK', 'rollback')
                  ).pipe(
                    Effect.ensuring(
                      Effect.sync(() => {
                        transaction.active = false
                      }),
                    ),
                  ),
              ),
            ),
      ),
  }
}

function isSqlError(cause: unknown): cause is SqlError.SqlError {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    '_tag' in cause &&
    cause._tag === 'SqlError'
  )
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
