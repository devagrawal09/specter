import { createFusedReactivityApp } from './app'
import { createReactiveComputation } from './features/reactivity/create-reactive-computation/impl'
import { createReactiveEffect } from './features/reactivity/create-reactive-effect/impl'
import { createReactiveSignal } from './features/reactivity/create-reactive-signal/impl'
import { disposeReactiveGraph } from './features/reactivity/dispose-reactive-graph/impl'
import { reactiveNodeValue } from './features/reactivity/reactive-node-value/impl'
import { settleReactiveBatch } from './features/reactivity/settle-reactive-batch/impl'
import type {
  ReactiveCallback,
  ReactiveValue,
} from './features/reactivity/model'
import { reactiveStore } from './features/reactivity/state'
import { writeReactiveSignal } from './features/reactivity/write-reactive-signal/impl'

export interface Signal<T> {
  read(): T
  write(value: T): void
}

export interface Computed<T> {
  read(): T
}

export interface ReactiveFramework {
  readonly name: string
  signal<T>(initialValue: T): Signal<T>
  computed<T>(fn: () => T): Computed<T>
  effect(fn: () => void): void
  withBatch<T>(fn: () => T): void
  withBuild<T>(fn: () => T): T
  cleanup(): void
}

export type SpecterFusedSyncFramework = ReactiveFramework & {
  readonly inspect: () => {
    readonly eventCount: number
    readonly eventTypes: readonly string[]
  }
}

export function createSpecterFusedSyncFramework(): SpecterFusedSyncFramework {
  const runtime = createFusedReactivityApp()
  let graphSequence = 0
  let nodeSequence = 0
  let batchSequence = 0
  let callbackSequence = 0
  let activeGraphId: string | undefined
  let activeBatchId: string | undefined

  const requireGraphId = () => {
    if (!activeGraphId) throw new Error('No reactive graph is being built')
    return activeGraphId
  }

  const requireBatchId = () => {
    if (!activeBatchId) throw new Error('No reactive batch is active')
    return activeBatchId
  }

  const read = <T>(graphId: string, nodeId: string): T =>
    runtime.query(reactiveNodeValue, {
      graphId,
      nodeId,
    }) as T

  const registerCallback = (
    graphId: string,
    callbackId: string,
    callback: ReactiveCallback,
  ) => {
    runtime.state(reactiveStore).registerCallback(graphId, callbackId, callback)
  }

  const settleIfPending = (graphId: string, batchId: string) => {
    if (runtime.state(reactiveStore).hasPendingBatch(graphId, batchId)) {
      runtime.command(settleReactiveBatch, { graphId, batchId })
    }
  }

  return {
    name: 'specter-fused-sync',
    signal<T>(initialValue: T): Signal<T> {
      const graphId = requireGraphId()
      const batchId = requireBatchId()
      const nodeId = `node-${++nodeSequence}`
      runtime.command(createReactiveSignal, {
        graphId,
        batchId,
        nodeId,
        initialValue: initialValue as ReactiveValue,
      })
      return {
        read: () => read<T>(graphId, nodeId),
        write(value: T) {
          const write = () => {
            runtime.command(writeReactiveSignal, {
              graphId,
              batchId: requireBatchId(),
              nodeId,
              value: value as ReactiveValue,
            })
          }
          if (activeBatchId) write()
          else {
            const batchId = `batch-${++batchSequence}`
            activeBatchId = batchId
            try {
              write()
              settleIfPending(graphId, batchId)
            } finally {
              activeBatchId = undefined
            }
          }
        },
      }
    },
    computed<T>(fn: () => T): Computed<T> {
      const graphId = requireGraphId()
      const batchId = requireBatchId()
      const nodeId = `node-${++nodeSequence}`
      const callbackId = `callback-${++callbackSequence}`
      registerCallback(graphId, callbackId, fn as ReactiveCallback)
      runtime.command(createReactiveComputation, {
        graphId,
        batchId,
        nodeId,
        callbackId,
      })
      return {
        read: () => read<T>(graphId, nodeId),
      }
    },
    effect(fn: () => void): void {
      const graphId = requireGraphId()
      const batchId = requireBatchId()
      const nodeId = `node-${++nodeSequence}`
      const callbackId = `callback-${++callbackSequence}`
      registerCallback(graphId, callbackId, () => {
        fn()
        return undefined
      })
      runtime.command(createReactiveEffect, {
        graphId,
        batchId,
        nodeId,
        callbackId,
      })
    },
    withBatch<T>(fn: () => T): void {
      const graphId = requireGraphId()
      if (activeBatchId) {
        fn()
        return
      }
      const batchId = `batch-${++batchSequence}`
      activeBatchId = batchId
      try {
        fn()
        settleIfPending(graphId, batchId)
      } finally {
        activeBatchId = undefined
      }
    },
    withBuild<T>(fn: () => T): T {
      if (activeGraphId) {
        throw new Error('A reactive graph is already active')
      }
      const graphId = `graph-${++graphSequence}`
      const batchId = `build-${++batchSequence}`
      activeGraphId = graphId
      activeBatchId = batchId
      try {
        const value = fn()
        settleIfPending(graphId, batchId)
        return value
      } finally {
        activeBatchId = undefined
      }
    },
    cleanup(): void {
      const graphId = activeGraphId
      if (!graphId) return
      if (runtime.state(reactiveStore).hasGraph(graphId)) {
        runtime.command(disposeReactiveGraph, { graphId })
      }
      runtime.reset()
      activeGraphId = undefined
      activeBatchId = undefined
      nodeSequence = 0
      callbackSequence = 0
    },
    inspect: () => ({
      eventCount: runtime.version,
      eventTypes: runtime.inspectEvents().map((event) => event.type),
    }),
  }
}
