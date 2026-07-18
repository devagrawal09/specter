import { createClient } from '@libsql/client/sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createSpecterApp } from '@specter-ts/core'
import {
  createSpecterSqlitePersistence,
  prepareSpecterSqlite,
} from '@specter-ts/sqlite'

import { resetWorklogMemoryStores } from './features/worklog/memory-store'
import { createWorklogAppConfig } from './features/worklog/registry'

export async function createWorklogRuntime(
  sqlitePath = process.env.WORKLOG_SQLITE_PATH ?? './data/worklog.db',
) {
  mkdirSync(dirname(sqlitePath), { recursive: true })
  const sqlite = createClient({ url: `file:${sqlitePath}` })
  await prepareSpecterSqlite(sqlite)
  resetWorklogMemoryStores()
  const persistence = createSpecterSqlitePersistence(sqlite)
  const app = await createSpecterApp(
    createWorklogAppConfig(persistence.eventLog),
  )
  return { app, sqlitePath, close: () => sqlite.close() }
}
