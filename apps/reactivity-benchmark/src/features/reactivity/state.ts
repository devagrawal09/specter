import type {
  FusedCommandContext,
  FusedStore,
} from '../../runtime/fused-slices'
import {
  reactiveBatchSettledEvent,
  reactiveComputationEvaluatedEvent,
  reactiveEffectExecutedEvent,
  type ReactiveEvent,
} from './events'
import type { ReactiveCallback, ReactiveValue } from './model'

type ReactiveNodeKind = 'signal' | 'computation' | 'effect'

type ReactiveNode = {
  readonly id: string
  readonly kind: ReactiveNodeKind
  value: ReactiveValue | undefined
  readonly callbackId?: string
  dependencies: number[]
  readonly subscribers: Set<number>
  initialized: boolean
  queuedToken: number
  effectToken: number
}

type PendingBatch = {
  readonly createdNodeIndexes: number[]
  readonly touchedSignals: Map<number, ReactiveValue>
}

type ReactiveGraph = {
  readonly id: string
  readonly nodes: ReactiveNode[]
  readonly nodeIndexes: Map<string, number>
  readonly pendingBatches: Map<string, PendingBatch>
  readonly settledBatches: Set<string>
  readonly seenEpochByNode: number[]
}

type ActiveEvaluation = {
  readonly graph: ReactiveGraph
  readonly epoch: number
  readonly dependencyIndexes: number[]
}

export class ReactiveState {
  readonly #graphs = new Map<string, ReactiveGraph>()
  readonly #disposedGraphIds = new Set<string>()
  readonly #callbacks = new Map<string, Map<string, ReactiveCallback>>()
  #activeEvaluation: ActiveEvaluation | undefined
  #evaluationEpoch = 0
  #scheduleToken = 0

  registerCallback(
    graphId: string,
    callbackId: string,
    callback: ReactiveCallback,
  ): void {
    const callbacks =
      this.#callbacks.get(graphId) ?? new Map<string, ReactiveCallback>()
    callbacks.set(callbackId, callback)
    this.#callbacks.set(graphId, callbacks)
  }

  isDisposed(graphId: string): boolean {
    return this.#disposedGraphIds.has(graphId)
  }

  hasGraph(graphId: string): boolean {
    return this.#graphs.has(graphId)
  }

  hasNode(graphId: string, nodeId: string): boolean {
    return this.#graphs.get(graphId)?.nodeIndexes.has(nodeId) ?? false
  }

  nodeKind(graphId: string, nodeId: string): ReactiveNodeKind | undefined {
    const graph = this.#graphs.get(graphId)
    const nodeIndex = graph?.nodeIndexes.get(nodeId)
    return nodeIndex === undefined ? undefined : graph?.nodes[nodeIndex]?.kind
  }

  isBatchSettled(graphId: string, batchId: string): boolean {
    return this.#graphs.get(graphId)?.settledBatches.has(batchId) ?? false
  }

  hasPendingBatch(graphId: string, batchId: string): boolean {
    return this.#graphs.get(graphId)?.pendingBatches.has(batchId) ?? false
  }

  read(graphId: string, nodeId: string): ReactiveValue {
    const graph = this.#requireGraph(graphId)
    const node = this.#requireNode(graph, nodeId)
    if (node.kind === 'effect') {
      throw new Error(`Reactive effect ${nodeId} has no readable value`)
    }
    if (node.value === undefined) {
      throw new Error(`Reactive computation ${nodeId} has not been evaluated`)
    }
    const active = this.#activeEvaluation
    if (active?.graph === graph) {
      const nodeIndex = graph.nodeIndexes.get(nodeId) as number
      if (graph.seenEpochByNode[nodeIndex] !== active.epoch) {
        graph.seenEpochByNode[nodeIndex] = active.epoch
        active.dependencyIndexes.push(nodeIndex)
      }
    }
    return node.value
  }

  settle(
    graphId: string,
    batchId: string,
    context: FusedCommandContext,
  ): { evaluatedComputationCount: number; executedEffectCount: number } {
    const graph = this.#requireGraph(graphId)
    const batch = graph.pendingBatches.get(batchId)
    if (!batch) {
      throw new Error(
        `Reactive batch ${batchId} has no pending work in graph ${graphId}`,
      )
    }

    const token = ++this.#scheduleToken
    const computationQueue: number[] = []
    const effectQueue: number[] = []

    const enqueue = (nodeIndex: number) => {
      const node = graph.nodes[nodeIndex]
      if (!node) return
      if (node.kind === 'effect') {
        if (node.effectToken === token) return
        node.effectToken = token
        effectQueue.push(nodeIndex)
        return
      }
      if (node.kind !== 'computation' || node.queuedToken === token) return
      node.queuedToken = token
      insertSorted(computationQueue, nodeIndex)
    }

    const enqueueSubscribers = (nodeIndex: number) => {
      const node = graph.nodes[nodeIndex]
      if (!node) return
      for (const subscriber of node.subscribers) enqueue(subscriber)
    }

    for (const nodeIndex of batch.createdNodeIndexes) enqueue(nodeIndex)
    for (const [nodeIndex, valueBeforeBatch] of batch.touchedSignals) {
      const node = graph.nodes[nodeIndex]
      if (node && !Object.is(valueBeforeBatch, node.value)) {
        enqueueSubscribers(nodeIndex)
      }
    }

    let evaluatedComputationCount = 0
    for (let cursor = 0; cursor < computationQueue.length; cursor += 1) {
      const nodeIndex = computationQueue[cursor]
      const node = graph.nodes[nodeIndex]
      if (!node || node.kind !== 'computation') continue
      const evaluation = this.#evaluate(graph, node)
      const changed =
        !node.initialized || !Object.is(node.value, evaluation.value)
      context.emit(
        reactiveComputationEvaluatedEvent.create({
          graphId,
          batchId,
          nodeId: node.id,
          value: evaluation.value,
          dependencyNodeIds: evaluation.dependencyNodeIds,
          changed,
        }),
      )
      evaluatedComputationCount += 1
      if (changed) enqueueSubscribers(nodeIndex)
    }

    effectQueue.sort((left, right) => left - right)
    let executedEffectCount = 0
    for (const nodeIndex of effectQueue) {
      const node = graph.nodes[nodeIndex]
      if (!node || node.kind !== 'effect') continue
      const evaluation = this.#evaluate(graph, node)
      context.emit(
        reactiveEffectExecutedEvent.create({
          graphId,
          batchId,
          nodeId: node.id,
          dependencyNodeIds: evaluation.dependencyNodeIds,
        }),
      )
      executedEffectCount += 1
    }

    return { evaluatedComputationCount, executedEffectCount }
  }

  apply(event: ReactiveEvent): void {
    switch (event.type) {
      case 'reactive-signal-created': {
        const graph = this.#getOrCreateGraph(event.payload.graphId)
        this.#addNode(graph, event.payload.batchId, {
          id: event.payload.nodeId,
          kind: 'signal',
          value: event.payload.value,
          dependencies: [],
          subscribers: new Set(),
          initialized: true,
          queuedToken: 0,
          effectToken: 0,
        })
        return
      }
      case 'reactive-computation-created':
      case 'reactive-effect-created': {
        const graph = this.#getOrCreateGraph(event.payload.graphId)
        this.#addNode(graph, event.payload.batchId, {
          id: event.payload.nodeId,
          kind:
            event.type === 'reactive-computation-created'
              ? 'computation'
              : 'effect',
          value: undefined,
          callbackId: event.payload.callbackId,
          dependencies: [],
          subscribers: new Set(),
          initialized: false,
          queuedToken: 0,
          effectToken: 0,
        })
        return
      }
      case 'reactive-signal-written': {
        const graph = this.#requireGraph(event.payload.graphId)
        const nodeIndex = graph.nodeIndexes.get(event.payload.nodeId)
        if (nodeIndex === undefined) return
        const node = graph.nodes[nodeIndex]
        if (!node) return
        const batch = this.#pendingBatch(graph, event.payload.batchId)
        if (!batch.touchedSignals.has(nodeIndex)) {
          batch.touchedSignals.set(nodeIndex, event.payload.previousValue)
        }
        node.value = event.payload.value
        return
      }
      case 'reactive-computation-evaluated': {
        const graph = this.#requireGraph(event.payload.graphId)
        const node = this.#requireNode(graph, event.payload.nodeId)
        this.#replaceDependencies(graph, node, event.payload.dependencyNodeIds)
        node.value = event.payload.value
        node.initialized = true
        return
      }
      case 'reactive-effect-executed': {
        const graph = this.#requireGraph(event.payload.graphId)
        const node = this.#requireNode(graph, event.payload.nodeId)
        this.#replaceDependencies(graph, node, event.payload.dependencyNodeIds)
        node.initialized = true
        return
      }
      case 'reactive-batch-settled': {
        const graph = this.#requireGraph(event.payload.graphId)
        graph.pendingBatches.delete(event.payload.batchId)
        graph.settledBatches.add(event.payload.batchId)
        return
      }
      case 'reactive-graph-disposed':
        this.#graphs.delete(event.payload.graphId)
        this.#callbacks.delete(event.payload.graphId)
        this.#disposedGraphIds.add(event.payload.graphId)
    }
  }

  #evaluate(
    graph: ReactiveGraph,
    node: ReactiveNode,
  ): { value: ReactiveValue; dependencyNodeIds: string[] } {
    const callbackId = node.callbackId
    const callback = callbackId
      ? this.#callbacks.get(graph.id)?.get(callbackId)
      : undefined
    if (!callback) {
      throw new Error(
        `Reactive callback ${callbackId ?? '<missing>'} is not registered in graph ${graph.id}`,
      )
    }

    const previous = this.#activeEvaluation
    const active: ActiveEvaluation = {
      graph,
      epoch: ++this.#evaluationEpoch,
      dependencyIndexes: [],
    }
    this.#activeEvaluation = active
    let value: ReactiveValue | undefined
    try {
      value = callback()
    } finally {
      this.#activeEvaluation = previous
    }

    if (node.kind === 'computation' && value === undefined) {
      throw new Error(`Reactive computation ${node.id} returned undefined`)
    }

    return {
      value: value === undefined ? null : value,
      dependencyNodeIds: active.dependencyIndexes.map(
        (nodeIndex) => graph.nodes[nodeIndex]?.id as string,
      ),
    }
  }

  #replaceDependencies(
    graph: ReactiveGraph,
    node: ReactiveNode,
    dependencyNodeIds: readonly string[],
  ): void {
    const nodeIndex = graph.nodeIndexes.get(node.id) as number
    for (const dependencyIndex of node.dependencies) {
      graph.nodes[dependencyIndex]?.subscribers.delete(nodeIndex)
    }
    const dependencyIndexes: number[] = []
    for (const dependencyNodeId of dependencyNodeIds) {
      const dependencyIndex = graph.nodeIndexes.get(dependencyNodeId)
      if (dependencyIndex === undefined) continue
      graph.nodes[dependencyIndex]?.subscribers.add(nodeIndex)
      dependencyIndexes.push(dependencyIndex)
    }
    node.dependencies = dependencyIndexes
  }

  #addNode(graph: ReactiveGraph, batchId: string, node: ReactiveNode): void {
    const nodeIndex = graph.nodes.length
    graph.nodeIndexes.set(node.id, nodeIndex)
    graph.nodes.push(node)
    graph.seenEpochByNode.push(0)
    this.#pendingBatch(graph, batchId).createdNodeIndexes.push(nodeIndex)
  }

  #getOrCreateGraph(graphId: string): ReactiveGraph {
    const existing = this.#graphs.get(graphId)
    if (existing) return existing
    const graph: ReactiveGraph = {
      id: graphId,
      nodes: [],
      nodeIndexes: new Map(),
      pendingBatches: new Map(),
      settledBatches: new Set(),
      seenEpochByNode: [],
    }
    this.#graphs.set(graphId, graph)
    return graph
  }

  #requireGraph(graphId: string): ReactiveGraph {
    const graph = this.#graphs.get(graphId)
    if (!graph) throw new Error(`Reactive graph ${graphId} was not found`)
    return graph
  }

  #requireNode(graph: ReactiveGraph, nodeId: string): ReactiveNode {
    const nodeIndex = graph.nodeIndexes.get(nodeId)
    const node = nodeIndex === undefined ? undefined : graph.nodes[nodeIndex]
    if (!node) {
      throw new Error(
        `Reactive node ${nodeId} was not found in graph ${graph.id}`,
      )
    }
    return node
  }

  #pendingBatch(graph: ReactiveGraph, batchId: string): PendingBatch {
    const existing = graph.pendingBatches.get(batchId)
    if (existing) return existing
    const batch: PendingBatch = {
      createdNodeIndexes: [],
      touchedSignals: new Map(),
    }
    graph.pendingBatches.set(batchId, batch)
    return batch
  }
}

export const reactiveStore: FusedStore<ReactiveState> = {
  createState: () => new ReactiveState(),
}

export function applyReactiveEvent(
  event: ReactiveEvent,
  state: ReactiveState,
): void {
  state.apply(event)
}

export function settleReactiveState(
  state: ReactiveState,
  graphId: string,
  batchId: string,
  context: FusedCommandContext,
): void {
  const counts = state.settle(graphId, batchId, context)
  context.emit(
    reactiveBatchSettledEvent.create({
      graphId,
      batchId,
      ...counts,
    }),
  )
}

function insertSorted(queue: number[], value: number): void {
  const last = queue.at(-1)
  if (last === undefined || last < value) {
    queue.push(value)
    return
  }
  let low = 0
  let high = queue.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if ((queue[middle] as number) < value) low = middle + 1
    else high = middle
  }
  queue.splice(low, 0, value)
}
