import { createClient } from '@libsql/client/sqlite3'
import { drizzle } from 'drizzle-orm/libsql/sqlite3'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventLog } from '@specter-ts/core'
import {
  createSpecterSqlitePersistence,
  prepareSpecterSqlite,
} from '@specter-ts/sqlite'
import { Effect, Layer } from 'effect'

import * as schema from './schema'
import { createSqliteSliceStoreLayer } from './specter-sqlite'
import { createTwilioDeliveryAttemptStore } from './twilio-delivery-attempts'
import { TwilioDeliveryAttempts } from '../features/narayan/send-twilio-outbound-reaction/twilio-outbound-plugin.server'

export type SqliteScenarioOptions = {
  migrationsFolder?: string
}

export function sqliteScenario(options: SqliteScenarioOptions = {}) {
  return async <T>(
    programOrRun:
      | Effect.Effect<T, unknown, unknown>
      | ((layer: Layer.Layer<any>) => Promise<T>),
  ) => {
    const dir = mkdtempSync(join(tmpdir(), 'narayan-ai-'))
    const sqlite = createClient({ url: `file:${join(dir, 'scenario.db')}` })

    try {
      const db = drizzle(sqlite, { schema })
      await migrate(db, {
        migrationsFolder:
          options.migrationsFolder ?? join(process.cwd(), 'drizzle'),
      })
      await prepareSpecterSqlite(sqlite)
      const persistence = createSpecterSqlitePersistence(sqlite)
      const storeLayer = createSqliteSliceStoreLayer(persistence.context)
      const layer = Layer.mergeAll(
        Layer.succeed(EventLog, persistence.eventLog),
        storeLayer,
        Layer.succeed(
          TwilioDeliveryAttempts,
          createTwilioDeliveryAttemptStore(db),
        ),
      )
      return await (typeof programOrRun === 'function'
        ? programOrRun(layer)
        : Effect.runPromise(
            programOrRun.pipe(Effect.provide(storeLayer)) as Effect.Effect<
              T,
              unknown,
              never
            >,
          ))
    } finally {
      sqlite.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
