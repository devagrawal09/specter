import {
  EventLog,
  type SliceStoreService,
  type SliceStoreTag,
} from '@specter-ts/core'
import { Context, Effect, Layer } from 'effect'

import {
  type NodeSqliteContext,
  openNodeSqlite,
  type NodeSqliteRuntimeOptions,
} from './database'
import {
  createNodeSqliteEventLogService,
  prepareNodeSqliteEventLog,
  type NodeSqliteEventLogOptions,
} from './event-log'
import {
  createNodeSqliteSliceStoreLayer,
  prepareNodeSqliteSliceStore,
  type NodeSqliteSliceStoreOptions,
} from './slice-store'

export type SpecterNodeSqliteOptions = NodeSqliteRuntimeOptions & {
  readonly eventLog?: NodeSqliteEventLogOptions
}

export type SpecterNodeSqliteRuntime = {
  readonly context: NodeSqliteContext
  readonly infrastructureLayer: Layer.Layer<EventLog>
  readonly sliceStoreLayer: <TIdentifier, TWrite, TRead = Readonly<TWrite>>(
    tag: SliceStoreTag<TIdentifier, SliceStoreService<TRead, TWrite, unknown>>,
    createState: () => TWrite,
    options?: NodeSqliteSliceStoreOptions<TWrite, TRead>,
  ) => Layer.Layer<TIdentifier>
}

export class SpecterNodeSqlite extends Context.Service<
  SpecterNodeSqlite,
  SpecterNodeSqliteRuntime
>()('@specter-ts/sqlite-node/SpecterNodeSqlite') {}

export function createSpecterNodeSqliteLayer(
  options: SpecterNodeSqliteOptions,
): Layer.Layer<SpecterNodeSqlite> {
  return Layer.effect(
    SpecterNodeSqlite,
    Effect.acquireRelease(
      Effect.sync(() => {
        const context = openNodeSqlite(options)
        prepareNodeSqliteEventLog(context)
        prepareNodeSqliteSliceStore(context)
        return {
          context,
          infrastructureLayer: Layer.succeed(
            EventLog,
            createNodeSqliteEventLogService(context, options.eventLog),
          ),
          sliceStoreLayer: (tag, createState, storeOptions) =>
            createNodeSqliteSliceStoreLayer(
              tag,
              context,
              createState,
              storeOptions,
            ),
        } satisfies SpecterNodeSqliteRuntime
      }),
      (runtime) => Effect.sync(() => runtime.context.database.close()),
    ),
  )
}
