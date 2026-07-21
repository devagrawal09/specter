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

export type PostgresDatabaseContext = {
  readonly advisoryLockKey: number
  connection(): PostgresConnection
  serialize<T>(run: () => Promise<T>): Promise<T>
  transaction<T>(
    run: (connection: PostgresConnection) => Promise<T>,
  ): Promise<T>
}

export type PostgresDatabaseOptions = {
  readonly advisoryLockKey?: number
}

const DEFAULT_ADVISORY_LOCK_KEY = 8_231_930

export function createPostgresDatabaseContext(
  pool: PostgresPool,
  options: PostgresDatabaseOptions = {},
): PostgresDatabaseContext {
  const advisoryLockKey = options.advisoryLockKey ?? DEFAULT_ADVISORY_LOCK_KEY
  let serializationTail = Promise.resolve()

  return {
    advisoryLockKey,
    connection() {
      return pool
    },
    async serialize(run) {
      const previous = serializationTail
      let release = () => {}
      const current = new Promise<void>((resolve) => {
        release = resolve
      })
      const queued = previous.then(() => current)
      serializationTail = queued
      await previous

      try {
        return await run()
      } finally {
        release()
        if (serializationTail === queued) serializationTail = Promise.resolve()
      }
    },
    async transaction(run) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await run(client)
        await client.query('COMMIT')
        return result
      } catch (cause) {
        try {
          await client.query('ROLLBACK')
        } catch {
          // Preserve the domain/storage failure that caused the rollback.
        }
        throw cause
      } finally {
        client.release()
      }
    },
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

/**
 * Reads a JSONB column from a structural Postgres driver.
 *
 * Postgres drivers such as `pg` decode JSONB before returning a row. In
 * particular, a JSON string is returned as a JavaScript string and must not be
 * parsed again: values such as `"null"`, `"123"`, and `"true"` are valid
 * strings, not encoded null/number/boolean values.
 */
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
