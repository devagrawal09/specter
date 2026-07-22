import { DatabaseSync } from 'node:sqlite'
import { Context, Effect, Exit, Option, Semaphore } from 'effect'

type ActiveNodeSqliteTransaction = {
  readonly owner: object
  active: boolean
}

const ActiveNodeSqliteTransaction =
  Context.Service<ActiveNodeSqliteTransaction>(
    '@specter-ts/sqlite-node/ActiveTransaction',
  )

export type NodeSqliteRuntimeOptions = {
  readonly filename: string
  readonly busyTimeoutMs?: number
}

export class NodeSqliteContext {
  readonly database: DatabaseSync
  readonly transactionEffect: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>

  constructor(database: DatabaseSync) {
    this.database = database
    const semaphore = Semaphore.makeUnsafe(1)
    const owner = {}
    this.transactionEffect = (effect) =>
      Effect.contextWith((services) => {
        const active = Context.getOption(services, ActiveNodeSqliteTransaction)
        return Option.isSome(active) &&
          active.value.owner === owner &&
          active.value.active
          ? effect
          : semaphore.withPermit(
              Effect.acquireUseRelease(
                Effect.sync(() => {
                  this.database.exec('BEGIN IMMEDIATE')
                  return { owner, active: true }
                }),
                (active) =>
                  effect.pipe(
                    Effect.provideService(ActiveNodeSqliteTransaction, active),
                  ),
                (active, exit) =>
                  Effect.sync(() => {
                    try {
                      this.database.exec(
                        Exit.isSuccess(exit) ? 'COMMIT' : 'ROLLBACK',
                      )
                    } finally {
                      active.active = false
                    }
                  }),
              ),
            )
      })
  }

  run<T>(operation: () => T): T {
    return operation()
  }
}

export function openNodeSqlite(options: NodeSqliteRuntimeOptions) {
  const database = new DatabaseSync(options.filename)
  database.exec('PRAGMA journal_mode = WAL')
  database.exec(`PRAGMA busy_timeout = ${options.busyTimeoutMs ?? 5000}`)
  database.exec('PRAGMA foreign_keys = ON')
  return new NodeSqliteContext(database)
}

export function requireNumber(value: unknown, field: string) {
  if (typeof value !== 'number') throw new TypeError(`Expected ${field} number`)
  return value
}

export function requireString(value: unknown, field: string) {
  if (typeof value !== 'string') throw new TypeError(`Expected ${field} string`)
  return value
}
