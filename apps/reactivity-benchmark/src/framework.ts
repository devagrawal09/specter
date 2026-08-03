import { createFusedReactivityApp } from './app'
import { createReactiveComputation } from './features/reactivity/create-reactive-computation/impl'
import { createReactiveEffect } from './features/reactivity/create-reactive-effect/impl'
import { createReactiveSignal } from './features/reactivity/create-reactive-signal/impl'
import { disposeReactiveGraph } from './features/reactivity/dispose-reactive-graph/impl'
import type {
  ReactiveCallback,
  ReactiveNodeValue,
  ReactiveValue,
} from './features/reactivity/model'
import { reactiveNodeValue } from './features/reactivity/reactive-node-value/impl'
import { settleReactiveBatch } from './features/reactivity/settle-reactive-batch/impl'
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

type ActiveBatch = {
  readonly id: string
  graphId: string | undefined
}

export function createSpecterFusedSyncFramework(): SpecterFusedSyncFramework {
  const runtime = createFusedReactivityApp()
  const ownedGraphIds = new Set<string>()
  let graphSequence = 0
  let nodeSequence = 0
  let batchSequence = 0
  let callbackSequence = 0
  let implicitGraphId: string | undefined
  let activeBatch: ActiveBatch | undefined

  const createGraph = () => {
    const graphId = `graph-${++graphSequence}`
    ownedGraphIds.add(graphId)
    return graphId
  }

  const implicitGraph = () => {
    if (!implicitGraphId) implicitGraphId = createGraph()
    return implicitGraphId
  }

  const claimBatchGraph = (batch: ActiveBatch, graphId: string) => {
    if (batch.graphId && batch.graphId !== graphId) {
      throw new Error(
        `Reactive batch ${batch.id} cannot span graphs ${batch.graphId} and ${graphId}`,
      )
    }
    batch.graphId = graphId
  }

  const discardGraph = (graphId: string) => {
    runtime.state(reactiveStore).discardGraph(graphId)
    ownedGraphIds.delete(graphId)
    if (implicitGraphId === graphId) implicitGraphId = undefined
  }

  const settle = (graphId: string, batchId: string) => {
    const state = runtime.state(reactiveStore)
    if (!state.hasPendingBatch(graphId, batchId)) return
    try {
      runtime.command(settleReactiveBatch, { graphId, batchId })
    } catch (error) {
      discardGraph(graphId)
      throw error
    }
  }

  const runInBatch = <T>(
    graphId: string,
    prefix: 'batch' | 'implicit',
    fn: (batchId: string) => T,
  ): T => {
    if (activeBatch) {
      claimBatchGraph(activeBatch, graphId)
      return fn(activeBatch.id)
    }
    const batch: ActiveBatch = {
      id: `${prefix}-${++batchSequence}`,
      graphId,
    }
    activeBatch = batch
    try {
      const result = fn(batch.id)
      settle(graphId, batch.id)
      return result
    } catch (error) {
      if (runtime.state(reactiveStore).hasGraph(graphId)) discardGraph(graphId)
      throw error
    } finally {
      activeBatch = undefined
    }
  }

  const graphForCreation = () => activeBatch?.graphId ?? implicitGraph()

  const read = <T>(graphId: string, nodeId: string): T => {
    const result = runtime.query(reactiveNodeValue, {
      graphId,
      nodeId,
    }) as ReactiveNodeValue
    if (result.status === 'available') return result.value as T
    if (result.status === 'batch-open') {
      throw new Error(
        `Reactive batch ${result.batchId} is still open in graph ${graphId}`,
      )
    }
    throw new Error(
      `Reactive node ${nodeId} is ${result.status} in graph ${graphId}`,
    )
  }

  const registerCallback = (
    graphId: string,
    callbackId: string,
    callback: ReactiveCallback,
  ) => {
    runtime.state(reactiveStore).registerCallback(graphId, callbackId, callback)
  }

  const createSignal = <T>(graphId: string, initialValue: T): Signal<T> => {
    const nodeId = `node-${++nodeSequence}`
    runInBatch(graphId, 'implicit', (batchId) => {
      runtime.command(createReactiveSignal, {
        graphId,
        batchId,
        nodeId,
        initialValue: initialValue as ReactiveValue,
      })
    })
    return {
      read: () => read<T>(graphId, nodeId),
      write(value: T) {
        runInBatch(graphId, 'batch', (batchId) => {
          runtime.command(writeReactiveSignal, {
            graphId,
            batchId,
            nodeId,
            value: value as ReactiveValue,
          })
        })
      },
    }
  }

  const createComputed = <T>(graphId: string, fn: () => T): Computed<T> => {
    const nodeId = `node-${++nodeSequence}`
    const callbackId = `callback-${++callbackSequence}`
    registerCallback(graphId, callbackId, fn as ReactiveCallback)
    try {
      runInBatch(graphId, 'implicit', (batchId) => {
        runtime.command(createReactiveComputation, {
          graphId,
          batchId,
          nodeId,
          callbackId,
        })
      })
    } catch (error) {
      runtime.state(reactiveStore).unregisterCallback(graphId, callbackId)
      throw error
    }
    return {
      read: () => read<T>(graphId, nodeId),
    }
  }

  const createEffect = (graphId: string, fn: () => void): void => {
    const nodeId = `node-${++nodeSequence}`
    const callbackId = `callback-${++callbackSequence}`
    registerCallback(graphId, callbackId, () => {
      fn()
      return undefined
    })
    try {
      runInBatch(graphId, 'implicit', (batchId) => {
        runtime.command(createReactiveEffect, {
          graphId,
          batchId,
          nodeId,
          callbackId,
        })
      })
    } catch (error) {
      runtime.state(reactiveStore).unregisterCallback(graphId, callbackId)
      throw error
    }
  }

  return {
    name: 'specter-fused-sync',
    signal<T>(initialValue: T): Signal<T> {
      return createSignal(graphForCreation(), initialValue)
    },
    computed<T>(fn: () => T): Computed<T> {
      return createComputed(graphForCreation(), fn)
    },
    effect(fn: () => void): void {
      createEffect(graphForCreation(), fn)
    },
    withBatch<T>(fn: () => T): void {
      if (activeBatch) {
        fn()
        return
      }
      const batch: ActiveBatch = {
        id: `batch-${++batchSequence}`,
        graphId: undefined,
      }
      activeBatch = batch
      try {
        fn()
        if (batch.graphId) settle(batch.graphId, batch.id)
      } catch (error) {
        if (
          batch.graphId &&
          runtime.state(reactiveStore).hasGraph(batch.graphId)
        ) {
          discardGraph(batch.graphId)
        }
        throw error
      } finally {
        activeBatch = undefined
      }
    },
    withBuild<T>(fn: () => T): T {
      if (activeBatch) {
        throw new Error('A reactive batch is already active')
      }
      const graphId = createGraph()
      const batch: ActiveBatch = {
        id: `build-${++batchSequence}`,
        graphId,
      }
      activeBatch = batch
      try {
        const value = fn()
        settle(graphId, batch.id)
        return value
      } catch (error) {
        if (runtime.state(reactiveStore).hasGraph(graphId)) {
          discardGraph(graphId)
        }
        throw error
      } finally {
        activeBatch = undefined
      }
    },
    cleanup(): void {
      for (const graphId of ownedGraphIds) {
        if (runtime.state(reactiveStore).hasGraph(graphId)) {
          runtime.command(disposeReactiveGraph, { graphId })
        }
      }
      runtime.reset()
      ownedGraphIds.clear()
      implicitGraphId = undefined
      activeBatch = undefined
      nodeSequence = 0
      callbackSequence = 0
    },
    inspect: () => ({
      eventCount: runtime.version,
      eventTypes: runtime.inspectEvents().map((event) => event.type),
    }),
  }
}
