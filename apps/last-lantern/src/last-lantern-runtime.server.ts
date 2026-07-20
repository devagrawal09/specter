import { createClient } from '@libsql/client/sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createSpecterApp } from '@specter-ts/core'
import {
  createSpecterSqlitePersistence,
  prepareSpecterSqlite,
} from '@specter-ts/sqlite'
import { resetLastLanternMemoryStores } from './features/last-lantern/memory-store'
import { createLastLanternAppConfig } from './features/last-lantern/registry'

export async function createLastLanternRuntime(
  sqlitePath = process.env.LAST_LANTERN_SQLITE_PATH ??
    './data/last-lantern.sqlite',
) {
  mkdirSync(dirname(sqlitePath), { recursive: true })
  const sqlite = createClient({ url: `file:${sqlitePath}` })
  await prepareSpecterSqlite(sqlite)
  resetLastLanternMemoryStores()
  const persistence = createSpecterSqlitePersistence(sqlite)
  const app = await createSpecterApp(
    createLastLanternAppConfig(persistence.eventLog),
  )
  return { app, sqlitePath, close: async () => sqlite.close() }
}
