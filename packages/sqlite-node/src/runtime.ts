import type {
  EventLogAdapter,
  ReactionScheduler,
  SliceStoreService,
  SliceStoreTag,
} from '@specter-ts/core'
import {
  createDurableReactionScheduler,
  type DurableReactionSchedulerOptions,
  type ReactionPass,
  type ReactionOutboxStore,
} from '@specter-ts/reaction-outbox'
import { Context, Effect, Layer } from 'effect'

import {
  type NodeSqliteContext,
  openNodeSqlite,
  type NodeSqliteRuntimeOptions,
} from './database'
import {
  createNodeSqliteEventLog,
  prepareNodeSqliteEventLog,
  type NodeSqliteEventLogOptions,
} from './event-log'
import {
  createNodeSqliteReactionOutboxStore,
  prepareNodeSqliteReactionOutbox,
} from './reaction-outbox'
import {
  createNodeSqliteSliceStoreLayer,
  prepareNodeSqliteSliceStore,
  type NodeSqliteSliceStoreOptions,
} from './slice-store'

export type SpecterNodeSqliteOptions = NodeSqliteRuntimeOptions & {
  readonly eventLog?: NodeSqliteEventLogOptions
  readonly reactions?: DurableReactionSchedulerOptions
}

export type SpecterNodeSqliteRuntime = {
  readonly context: NodeSqliteContext
  readonly eventLog: EventLogAdapter
  readonly schedule: ReactionScheduler
  readonly reactionOutbox: ReactionOutboxStore<ReactionPass>
  readonly sliceStoreLayer: <
    TIdentifier,
    TWriteState,
    TReadState = Readonly<TWriteState>,
  >(
    tag: SliceStoreTag<
      TIdentifier,
      SliceStoreService<TReadState, TWriteState, unknown>
    >,
    createState: () => TWriteState,
    options?: NodeSqliteSliceStoreOptions<TWriteState, TReadState>,
  ) => Layer.Layer<TIdentifier>
  readonly createReactionOutboxStore: <
    TPayload,
  >() => ReactionOutboxStore<TPayload>
  readonly close: () => Promise<void>
}

export const SpecterNodeSqlite = Context.Service<SpecterNodeSqliteRuntime>(
  '@specter-ts/sqlite-node/SpecterNodeSqlite',
)

export function openSpecterNodeSqlite(
  options: SpecterNodeSqliteOptions,
): SpecterNodeSqliteRuntime {
  const context = openNodeSqlite(options)
  prepareNodeSqliteEventLog(context)
  prepareNodeSqliteSliceStore(context)
  prepareNodeSqliteReactionOutbox(context)
  const reactionOutbox =
    createNodeSqliteReactionOutboxStore<ReactionPass>(context)
  const controller = new AbortController()
  const schedule = createDurableReactionScheduler(reactionOutbox, {
    ...options.reactions,
    signal: controller.signal,
  })
  let closed = false

  return {
    context,
    eventLog: createNodeSqliteEventLog(context, options.eventLog),
    schedule,
    reactionOutbox,
    sliceStoreLayer: (tag, createState, storeOptions) =>
      createNodeSqliteSliceStoreLayer(
        tag,
        context,
        createState,
        storeOptions,
      ),
    createReactionOutboxStore: () =>
      createNodeSqliteReactionOutboxStore(context),
    close: async () => {
      if (closed) return
      closed = true
      controller.abort()
      context.database.close()
    },
  }
}

export function createSpecterNodeSqliteLayer(
  options: SpecterNodeSqliteOptions,
): Layer.Layer<SpecterNodeSqliteRuntime> {
  return Layer.effect(
    SpecterNodeSqlite,
    Effect.acquireRelease(
      Effect.sync(() => openSpecterNodeSqlite(options)),
      (runtime) => Effect.promise(runtime.close),
    ),
  )
}
