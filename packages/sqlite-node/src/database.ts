import { DatabaseSync } from 'node:sqlite'

export type NodeSqliteRuntimeOptions = {
  readonly filename: string
  readonly busyTimeoutMs?: number
}

export class NodeSqliteContext {
  readonly database: DatabaseSync

  constructor(database: DatabaseSync) {
    this.database = database
  }

  run<T>(operation: () => T): T {
    return operation()
  }

  transaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      this.database.exec('COMMIT')
      return result
    } catch (cause) {
      this.database.exec('ROLLBACK')
      throw cause
    }
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
