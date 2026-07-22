import { createClient } from '@libsql/client/sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createSpecterApp, EventLog } from '@specter-ts/core'
import { createImmediateReactionSchedulerLayer } from '@specter-ts/memory'
import {
  createSpecterSqlitePersistence,
  prepareSpecterSqlite,
} from '@specter-ts/sqlite'
import { Layer } from 'effect'

import {
  resetWorklogMemoryStores,
  worklogMemoryStoresLayer,
} from './features/worklog/memory-store'
import { worklogAppConfig } from './features/worklog/registry'

export async function createWorklogRuntime(
  sqlitePath = process.env.WORKLOG_SQLITE_PATH ?? './data/worklog.db',
) {
  mkdirSync(dirname(sqlitePath), { recursive: true })
  const sqlite = createClient({ url: `file:${sqlitePath}` })
  await prepareSpecterSqlite(sqlite)
  resetWorklogMemoryStores()
  const persistence = createSpecterSqlitePersistence(sqlite)
  const app = await createSpecterApp(
    worklogAppConfig,
    Layer.mergeAll(
      Layer.succeed(EventLog, persistence.eventLog),
      createImmediateReactionSchedulerLayer(),
      worklogMemoryStoresLayer(),
    ),
  )
  return {
    app,
    sqlitePath,
    close: async () => {
      await app.close()
      sqlite.close()
    },
  }
}
