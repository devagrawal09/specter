import * as SqliteDrizzle from '@effect/sql-drizzle/Sqlite'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { Layer } from 'effect'

import { EventLogLive } from './event-log'
import type { RegistryRuntime } from './services'
import { JsonTx } from './services'
import { SliceStatesLive } from './slice-state'

export function createRegistryRuntimeLayer(runtime: RegistryRuntime) {
  const sql = SqliteClient.layer({ filename: runtime.sqliteFilename })
  const drizzle = SqliteDrizzle.layer.pipe(Layer.provide(sql))
  const jsonSlices = Layer.succeed(JsonTx, runtime.jsonStorage)

  return Layer.mergeAll(
    sql,
    drizzle,
    jsonSlices,
    EventLogLive.pipe(Layer.provide(drizzle)),
    SliceStatesLive.pipe(Layer.provide(Layer.merge(drizzle, jsonSlices))),
  )
}
