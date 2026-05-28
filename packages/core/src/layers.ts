import * as SqliteDrizzle from '@effect/sql-drizzle/Sqlite'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { Layer } from 'effect'

import { EventLogLive } from './event-log'
import type { SpecterAppRuntime } from './services'
import { SliceStatesLive } from './slice-state'

export function createSpecterAppRuntimeLayer(runtime: SpecterAppRuntime) {
  const sql = SqliteClient.layer({ filename: runtime.sqliteFilename })
  const drizzle = SqliteDrizzle.layer.pipe(Layer.provide(sql))

  return Layer.mergeAll(
    sql,
    drizzle,
    EventLogLive.pipe(Layer.provide(drizzle)),
    SliceStatesLive.pipe(Layer.provide(drizzle)),
  )
}
