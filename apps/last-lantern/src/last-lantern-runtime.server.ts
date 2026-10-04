import { createClient } from '@libsql/client/sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createSpecterApp, EventLog } from '@specter-ts/core'
import {
  createSpecterSqlitePersistence,
  prepareSpecterSqlite,
} from '@specter-ts/sqlite'
import { Layer } from 'effect'

import {
  createLastLanternStoreLayer,
  lastLanternAppConfig,
} from './features/last-lantern/registry'

export async function createLastLanternRuntime(
  sqlitePath = process.env.LAST_LANTERN_SQLITE_PATH ??
    './data/last-lantern.sqlite',
) {
  mkdirSync(dirname(sqlitePath), { recursive: true })
  const sqlite = createClient({ url: `file:${sqlitePath}` })
  await prepareSpecterSqlite(sqlite)
  const persistence = createSpecterSqlitePersistence(sqlite)
  const app = await createSpecterApp(
    lastLanternAppConfig,
    Layer.mergeAll(
      Layer.succeed(EventLog, persistence.eventLog),
      createLastLanternStoreLayer(),
    ),
  )
  await app.query({ type: 'lanternTableQuery', payload: {} })
  return {
    app,
    sqlitePath,
    close: async () => {
      try {
        await app.close()
      } finally {
        sqlite.close()
      }
    },
  }
}
