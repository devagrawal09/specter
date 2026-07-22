import { Context, Effect, Exit, Option } from 'effect'

export type PostgresQueryResult<TRow extends object = Record<string, unknown>> =
  {
    readonly rows: readonly TRow[]
    readonly rowCount?: number | null
  }

export type PostgresConnection = {
  query<TRow extends object = Record<string, unknown>>(
    sql: string,
    parameters?: unknown[],
  ): Promise<PostgresQueryResult<TRow>>
}

export type PostgresPoolClient = PostgresConnection & {
  release(): void
}

export type PostgresPool = PostgresConnection & {
  connect(): Promise<PostgresPoolClient>
}

export class PostgresDatabaseFailure extends Error {
  readonly _tag = 'PostgresDatabaseFailure' as const

  constructor(
    readonly operation: 'connect' | 'begin' | 'commit' | 'rollback',
    readonly cause: unknown,
  ) {
    super(`Postgres ${operation} failed.`, { cause })
    this.name = 'PostgresDatabaseFailure'
  }
}

export type PostgresDatabaseContext = {
  readonly pool: PostgresPool
  readonly advisoryLockKey: number
  readonly use: <A, E, R>(
    run: (connection: PostgresConnection) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>
  readonly transaction: <A, E, R>(
    run: (connection: PostgresConnection) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | PostgresDatabaseFailure, R>
}

type ActivePostgresTransaction = {
  readonly owner: object
  readonly connection: PostgresConnection
  active: boolean
}

const ActivePostgresTransaction = Context.Service<ActivePostgresTransaction>(
  '@specter-ts/postgres/ActiveTransaction',
)

export type PostgresDatabaseOptions = {
  readonly advisoryLockKey?: number
}

const DEFAULT_ADVISORY_LOCK_KEY = 8_231_930

export function createPostgresDatabaseContext(
  pool: PostgresPool,
  options: PostgresDatabaseOptions = {},
): PostgresDatabaseContext {
  const owner = {}
  const activeConnection = Effect.contextWith<
    never,
    PostgresConnection,
    never,
    never
  >((services) => {
    const active = Context.getOption(services, ActivePostgresTransaction)
    return Effect.succeed(
      Option.isSome(active) &&
        active.value.owner === owner &&
        active.value.active
        ? active.value.connection
        : pool,
    )
  })

  return {
    pool,
    advisoryLockKey: options.advisoryLockKey ?? DEFAULT_ADVISORY_LOCK_KEY,
    use: (run) => Effect.flatMap(activeConnection, run),
    transaction: (run) =>
      Effect.flatMap(activeConnection, (active) =>
        active !== pool
          ? run(active)
          : Effect.acquireUseRelease(
              Effect.tryPromise({
                try: async () => {
                  const connection = await pool.connect()
                  return {
                    connection,
                    active: { owner, connection, active: true },
                  }
                },
                catch: (cause) => new PostgresDatabaseFailure('connect', cause),
              }),
              ({ connection, active }) =>
                Effect.gen(function* () {
                  yield* Effect.tryPromise({
                    try: () => connection.query('BEGIN'),
                    catch: (cause) =>
                      new PostgresDatabaseFailure('begin', cause),
                  })
                  return yield* run(connection).pipe(
                    Effect.provideService(ActivePostgresTransaction, active),
                  )
                }),
              ({ connection, active }, exit) =>
                (Exit.isSuccess(exit)
                  ? Effect.tryPromise({
                      try: () => connection.query('COMMIT'),
                      catch: (cause) =>
                        new PostgresDatabaseFailure('commit', cause),
                    })
                  : Effect.tryPromise({
                      try: () => connection.query('ROLLBACK'),
                      catch: (cause) =>
                        new PostgresDatabaseFailure('rollback', cause),
                    })
                ).pipe(
                  Effect.asVoid,
                  Effect.ensuring(
                    Effect.sync(() => {
                      active.active = false
                      connection.release()
                    }),
                  ),
                ),
            ),
      ),
  }
}

export function postgresNumber(value: unknown, field: string) {
  const number = typeof value === 'string' ? Number(value) : value
  if (
    typeof number !== 'number' ||
    !Number.isSafeInteger(number) ||
    number < 0
  ) {
    throw new Error(`Invalid Postgres ${field}: ${String(value)}`)
  }
  return number
}

export function postgresString(value: unknown, field: string) {
  if (typeof value !== 'string') {
    throw new Error(`Invalid Postgres ${field}: ${String(value)}`)
  }
  return value
}

export function postgresJson<T>(value: unknown, field: string): T {
  if (value === undefined) {
    throw new Error(`Invalid Postgres ${field}: undefined`)
  }
  return value as T
}

export function postgresDate(value: unknown, field: string) {
  const date =
    value instanceof Date ? value : new Date(postgresString(value, field))
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid Postgres ${field}: ${String(value)}`)
  }
  return date
}
