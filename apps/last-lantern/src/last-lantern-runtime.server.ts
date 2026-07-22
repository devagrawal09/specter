import { createClient } from '@libsql/client/sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createSpecterApp, EventLog, SpecterObserver } from '@specter-ts/core'
import {
  createRuntimeObservationEmitter,
  createRuntimeObservationProducer,
  type RuntimeSource,
} from '@specter-ts/observability'
import {
  createSpecterSqlitePersistence,
  prepareSpecterSqlite,
} from '@specter-ts/sqlite'
import { Layer } from 'effect'

import {
  createLastLanternStoreLayer,
  lastLanternAppConfig,
} from './features/last-lantern/registry'
import {
  lastLanternSpecificationDigests,
  lastLanternSpecifications,
} from './features/last-lantern/specifications'

export async function createLastLanternRuntime(
  sqlitePath = process.env.LAST_LANTERN_SQLITE_PATH ??
    './data/last-lantern.sqlite',
) {
  mkdirSync(dirname(sqlitePath), { recursive: true })
  const sqlite = createClient({ url: `file:${sqlitePath}` })
  await prepareSpecterSqlite(sqlite)
  const persistence = createSpecterSqlitePersistence(sqlite)
  const runtimeSource: RuntimeSource = {
    application: 'last-lantern',
    environment:
      process.env.SPECTER_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    runtimeLanguage: 'typescript',
    runtimeVersion: '0.4.0',
    instanceId:
      process.env.SPECTER_INSTANCE_ID ?? `last-lantern-${process.pid}`,
    eventLogId: process.env.SPECTER_EVENT_LOG_ID ?? sqlitePath,
  }
  const observationProducer = createRuntimeObservationProducer({
    collectorUrl:
      process.env.SPECTER_OBSERVABILITY_URL ?? 'http://127.0.0.1:41739',
    source: runtimeSource,
    specifications: lastLanternSpecifications,
    closeTimeoutMs: 250,
  })
  const runtimeObservability = createRuntimeObservationEmitter({
    producer: observationProducer,
    source: runtimeSource,
    specificationDigests: lastLanternSpecificationDigests,
  })
  const app = await createSpecterApp(
    lastLanternAppConfig,
    Layer.mergeAll(
      Layer.succeed(EventLog, persistence.eventLog),
      createLastLanternStoreLayer(),
      Layer.succeed(SpecterObserver, runtimeObservability.observer),
    ),
  )
  return {
    app,
    sqlitePath,
    close: async () => {
      await observationProducer.close()
      sqlite.close()
    },
  }
}
