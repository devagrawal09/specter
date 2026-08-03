import type { FusedEventDraft, FusedStore } from '../../runtime/fused-slices'
import {
  reactiveBatchSettledEvent,
  reactiveComputationEvaluatedEvent,
  reactiveEffectExecutedEvent,
  type ReactiveEvent,
} from './events'
import type {
  ReactiveCallback,
  ReactiveNodeValue,
  ReactiveValue,
} from './model'

type ReactiveNodeKind = 'signal' | 'computation' | 'effect'

type ReactiveNode = {
  readonly id: string
  readonly kind: ReactiveNodeKind
  value: ReactiveValue | undefined
  readonly callbackId?: string
  dependencies: number[]
  readonly subscribers: Set<number>
  initialized: boolean
}

type PendingBatch = {
  readonly createdNodeIndexes: number[]
  readonly touchedSignals: Map<number, ReactiveValue>
}

type ReactiveGraph = {
  readonly id: string
  readonly nodes: ReactiveNode[]
  readonly nodeIndexes: Map<string, number>
  readonly assignedCallbackIds: Set<string>
  readonly settledBatchIds: Set<string>
  readonly seenEpochByNode: number[]
  openBatchId: string | undefined
  pendingBatch: PendingBatch | undefined
}

type ActiveEvaluation = {
  readonly graph: ReactiveGraph
  readonly epoch: number
  readonly dependencyIndexes: number[]
}

type Settlement = {
  readonly graph: ReactiveGraph
  readonly batchId: string
  readonly dirtyComputations: Set<number>
  readonly evaluatedComputations: Set<number>
  readonly evaluatingComputations: Set<number>
  readonly scheduledComputations: Set<number>
  readonly computationHeap: number[]
  readonly effectIndexes: Set<number>
  readonly events: FusedEventDraft[]
  evaluatedComputationCount: number
  executedEffectCount: number
}

export class ReactiveCallbackEvaluationError extends Error {
  constructor(
    readonly callbackId: string,
    readonly graphId: string,
    options?: ErrorOptions,
  ) {
    super(`Reactive callback ${callbackId} failed in graph ${graphId}`, options)
    this.name = 'ReactiveCallbackEvaluationError'
  }
}

export class ReactiveState {
  readonly #graphs = new Map<string, ReactiveGraph>()
  readonly #disposedGraphIds = new Set<string>()
  readonly #callbacks = new Map<string, Map<string, ReactiveCallback>>()
  #activeEvaluation: ActiveEvaluation | undefined
  #settlement: Settlement | undefined
  #evaluationEpoch = 0

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

  unregisterCallback(graphId: string, callbackId: string): void {
    const callbacks = this.#callbacks.get(graphId)
    callbacks?.delete(callbackId)
    if (callbacks?.size === 0) this.#callbacks.delete(graphId)
  }

  hasRegisteredCallback(graphId: string, callbackId: string): boolean {
    return this.#callbacks.get(graphId)?.has(callbackId) ?? false
  }

  isCallbackAssigned(graphId: string, callbackId: string): boolean {
    return (
      this.#graphs.get(graphId)?.assignedCallbackIds.has(callbackId) ?? false
    )
  }

  isDisposed(graphId: string): boolean {
    return this.#disposedGraphIds.has(graphId)
  }

  isSettling(graphId: string): boolean {
    return this.#settlement?.graph.id === graphId
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
    return this.#graphs.get(graphId)?.settledBatchIds.has(batchId) ?? false
  }

  openBatchId(graphId: string): string | undefined {
    return this.#graphs.get(graphId)?.openBatchId
  }

  hasPendingBatch(graphId: string, batchId: string): boolean {
    const graph = this.#graphs.get(graphId)
    return graph?.openBatchId === batchId && graph.pendingBatch !== undefined
  }

  mutationRejection(graphId: string, batchId: string): string | undefined {
    if (this.isDisposed(graphId)) {
      return `Reactive graph ${graphId} is disposed`
    }
    const graph = this.#graphs.get(graphId)
    if (!graph) return undefined
    if (graph.settledBatchIds.has(batchId)) {
      return `Reactive batch ${batchId} is already settled in graph ${graphId}`
    }
    if (graph.openBatchId && graph.openBatchId !== batchId) {
      return `Reactive batch ${graph.openBatchId} is already open in graph ${graphId}`
    }
    return undefined
  }

  callbackRejection(graphId: string, callbackId: string): string | undefined {
    if (!this.hasRegisteredCallback(graphId, callbackId)) {
      return `Reactive callback ${callbackId} is not registered in graph ${graphId}`
    }
    if (this.isCallbackAssigned(graphId, callbackId)) {
      return `Reactive callback ${callbackId} is already assigned in graph ${graphId}`
    }
    return undefined
  }

  nodeValue(graphId: string, nodeId: string): ReactiveNodeValue {
    if (this.#disposedGraphIds.has(graphId)) {
      return { status: 'graph-disposed' }
    }
    const graph = this.#graphForRead(graphId)
    if (!graph) return { status: 'graph-not-found' }
    if (graph.openBatchId && this.#settlement?.graph !== graph) {
      return { status: 'batch-open', batchId: graph.openBatchId }
    }
    const nodeIndex = graph.nodeIndexes.get(nodeId)
    if (nodeIndex === undefined) return { status: 'not-found' }
    const node = graph.nodes[nodeIndex]
    if (!node) return { status: 'not-found' }
    if (node.kind === 'effect') return { status: 'not-readable' }
    return { status: 'available', value: this.#read(graph, nodeIndex) }
  }

  signalValue(graphId: string, nodeId: string): ReactiveValue {
    const graph = this.#requireStoredGraph(graphId)
    const node = this.#requireNode(graph, nodeId)
    if (node.kind !== 'signal' || node.value === undefined) {
      throw new Error(`Reactive node ${nodeId} is not a signal`)
    }
    return node.value
  }

  settle(graphId: string, batchId: string): readonly FusedEventDraft[] {
    const original = this.#requireStoredGraph(graphId)
    const batch = original.pendingBatch
    if (!batch || original.openBatchId !== batchId) {
      throw new Error(
        `Reactive batch ${batchId} has no pending work in graph ${graphId}`,
      )
    }

    const graph = cloneGraph(original)
    const settlement: Settlement = {
      graph,
      batchId,
      dirtyComputations: new Set(),
      evaluatedComputations: new Set(),
      evaluatingComputations: new Set(),
      scheduledComputations: new Set(),
      computationHeap: [],
      effectIndexes: new Set(),
      events: [],
      evaluatedComputationCount: 0,
      executedEffectCount: 0,
    }
    this.#settlement = settlement

    try {
      for (const nodeIndex of batch.createdNodeIndexes) {
        this.#enqueue(settlement, nodeIndex)
      }
      for (const [nodeIndex, valueBeforeBatch] of batch.touchedSignals) {
        const node = graph.nodes[nodeIndex]
        if (node && !Object.is(valueBeforeBatch, node.value)) {
          this.#enqueueSubscribers(settlement, nodeIndex)
        }
      }

      while (settlement.computationHeap.length > 0) {
        const nodeIndex = heapPop(settlement.computationHeap)
        if (nodeIndex === undefined) break
        settlement.scheduledComputations.delete(nodeIndex)
        this.#evaluateComputation(settlement, nodeIndex)
      }

      for (const nodeIndex of [...settlement.effectIndexes].sort(
        (left, right) => left - right,
      )) {
        const node = graph.nodes[nodeIndex]
        if (!node || node.kind !== 'effect') continue
        const evaluation = this.#evaluateCallback(graph, node)
        this.#replaceDependencies(graph, node, evaluation.dependencyNodeIds)
        node.initialized = true
        settlement.events.push(
          reactiveEffectExecutedEvent.create({
            graphId,
            batchId,
            nodeId: node.id,
            dependencyNodeIds: evaluation.dependencyNodeIds,
          }),
        )
        settlement.executedEffectCount += 1
      }

      settlement.events.push(
        reactiveBatchSettledEvent.create({
          graphId,
          batchId,
          evaluatedComputationCount: settlement.evaluatedComputationCount,
          executedEffectCount: settlement.executedEffectCount,
        }),
      )
      return settlement.events
    } finally {
      this.#settlement = undefined
      this.#activeEvaluation = undefined
    }
  }

  discardGraph(graphId: string): void {
    this.#graphs.delete(graphId)
    this.#callbacks.delete(graphId)
    this.#disposedGraphIds.add(graphId)
  }

  apply(event: ReactiveEvent): void {
    switch (event.type) {
      case 'reactive-signal-created': {
        const graph = this.#graphForCreate(event.payload.graphId)
        this.#openBatch(graph, event.payload.batchId)
        this.#assertNewNode(graph, event.payload.nodeId)
        this.#addNode(graph, {
          id: event.payload.nodeId,
          kind: 'signal',
          value: event.payload.value,
          dependencies: [],
          subscribers: new Set(),
          initialized: true,
        })
        return
      }
      case 'reactive-computation-created':
      case 'reactive-effect-created': {
        const graph = this.#graphForCreate(event.payload.graphId)
        this.#openBatch(graph, event.payload.batchId)
        this.#assertNewNode(graph, event.payload.nodeId)
        if (!this.hasRegisteredCallback(graph.id, event.payload.callbackId)) {
          throw new Error(
            `Reactive callback ${event.payload.callbackId} is not registered in graph ${graph.id}`,
          )
        }
        if (graph.assignedCallbackIds.has(event.payload.callbackId)) {
          throw new Error(
            `Reactive callback ${event.payload.callbackId} is already assigned in graph ${graph.id}`,
          )
        }
        graph.assignedCallbackIds.add(event.payload.callbackId)
        this.#addNode(graph, {
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
        })
        return
      }
      case 'reactive-signal-written': {
        const graph = this.#requireStoredGraph(event.payload.graphId)
        const nodeIndex = graph.nodeIndexes.get(event.payload.nodeId)
        const node =
          nodeIndex === undefined ? undefined : graph.nodes[nodeIndex]
        if (nodeIndex === undefined || !node || node.kind !== 'signal') {
          throw new Error(
            `Malformed reactive history: signal ${event.payload.nodeId} does not exist in graph ${graph.id}`,
          )
        }
        if (!Object.is(node.value, event.payload.previousValue)) {
          throw new Error(
            `Malformed reactive history: previous value does not match signal ${node.id}`,
          )
        }
        this.#openBatch(graph, event.payload.batchId)
        const batch = graph.pendingBatch as PendingBatch
        if (!batch.touchedSignals.has(nodeIndex)) {
          batch.touchedSignals.set(nodeIndex, event.payload.previousValue)
        }
        node.value = event.payload.value
        return
      }
      case 'reactive-computation-evaluated': {
        const graph = this.#requireStoredGraph(event.payload.graphId)
        this.#assertEventBatch(graph, event.payload.batchId)
        const node = this.#requireNode(graph, event.payload.nodeId)
        if (node.kind !== 'computation') {
          throw new Error(
            `Malformed reactive history: node ${node.id} is not a computation`,
          )
        }
        this.#replaceDependencies(graph, node, event.payload.dependencyNodeIds)
        node.value = event.payload.value
        node.initialized = true
        return
      }
      case 'reactive-effect-executed': {
        const graph = this.#requireStoredGraph(event.payload.graphId)
        this.#assertEventBatch(graph, event.payload.batchId)
        const node = this.#requireNode(graph, event.payload.nodeId)
        if (node.kind !== 'effect') {
          throw new Error(
            `Malformed reactive history: node ${node.id} is not an effect`,
          )
        }
        this.#replaceDependencies(graph, node, event.payload.dependencyNodeIds)
        node.initialized = true
        return
      }
      case 'reactive-batch-settled': {
        const graph = this.#requireStoredGraph(event.payload.graphId)
        this.#assertEventBatch(graph, event.payload.batchId)
        graph.pendingBatch = undefined
        graph.openBatchId = undefined
        graph.settledBatchIds.add(event.payload.batchId)
        return
      }
      case 'reactive-graph-disposed':
        this.discardGraph(event.payload.graphId)
    }
  }

  #evaluateComputation(settlement: Settlement, nodeIndex: number): void {
    if (settlement.evaluatedComputations.has(nodeIndex)) return
    if (settlement.evaluatingComputations.has(nodeIndex)) {
      const node = settlement.graph.nodes[nodeIndex]
      throw new Error(
        `Reactive dependency cycle reached ${node?.id ?? nodeIndex} in graph ${settlement.graph.id}`,
      )
    }
    const node = settlement.graph.nodes[nodeIndex]
    if (!node || node.kind !== 'computation') return

    settlement.evaluatingComputations.add(nodeIndex)
    try {
      for (const dependencyIndex of node.dependencies) {
        if (settlement.dirtyComputations.has(dependencyIndex)) {
          this.#evaluateComputation(settlement, dependencyIndex)
        }
      }
      const evaluation = this.#evaluateCallback(settlement.graph, node)
      const changed =
        !node.initialized || !Object.is(node.value, evaluation.value)
      this.#replaceDependencies(
        settlement.graph,
        node,
        evaluation.dependencyNodeIds,
      )
      node.value = evaluation.value
      node.initialized = true
      settlement.events.push(
        reactiveComputationEvaluatedEvent.create({
          graphId: settlement.graph.id,
          batchId: settlement.batchId,
          nodeId: node.id,
          value: evaluation.value,
          dependencyNodeIds: evaluation.dependencyNodeIds,
          changed,
        }),
      )
      settlement.evaluatedComputationCount += 1
      settlement.evaluatedComputations.add(nodeIndex)
      if (changed) this.#enqueueSubscribers(settlement, nodeIndex)
    } finally {
      settlement.evaluatingComputations.delete(nodeIndex)
    }
  }

  #evaluateCallback(
    graph: ReactiveGraph,
    node: ReactiveNode,
  ): { value: ReactiveValue; dependencyNodeIds: string[] } {
    const callbackId = node.callbackId
    const callback = callbackId
      ? this.#callbacks.get(graph.id)?.get(callbackId)
      : undefined
    if (!callback || !callbackId) {
      throw new ReactiveCallbackEvaluationError(
        callbackId ?? '<missing>',
        graph.id,
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
    } catch (error) {
      if (error instanceof ReactiveCallbackEvaluationError) throw error
      throw new ReactiveCallbackEvaluationError(callbackId, graph.id, {
        cause: error,
      })
    } finally {
      this.#activeEvaluation = previous
    }

    if (node.kind === 'computation' && value === undefined) {
      throw new ReactiveCallbackEvaluationError(callbackId, graph.id, {
        cause: new Error(`Reactive computation ${node.id} returned undefined`),
      })
    }

    return {
      value: value === undefined ? null : value,
      dependencyNodeIds: active.dependencyIndexes.map(
        (nodeIndex) => graph.nodes[nodeIndex]?.id as string,
      ),
    }
  }

  #read(graph: ReactiveGraph, nodeIndex: number): ReactiveValue {
    const node = graph.nodes[nodeIndex]
    if (!node || node.kind === 'effect') {
      throw new Error(`Reactive node ${node?.id ?? nodeIndex} is not readable`)
    }
    const settlement = this.#settlement
    if (
      node.kind === 'computation' &&
      settlement?.graph === graph &&
      settlement.dirtyComputations.has(nodeIndex)
    ) {
      this.#evaluateComputation(settlement, nodeIndex)
    }
    if (node.value === undefined) {
      throw new Error(`Reactive computation ${node.id} has not been evaluated`)
    }
    const active = this.#activeEvaluation
    if (active?.graph === graph) {
      if (graph.seenEpochByNode[nodeIndex] !== active.epoch) {
        graph.seenEpochByNode[nodeIndex] = active.epoch
        active.dependencyIndexes.push(nodeIndex)
      }
    }
    return node.value
  }

  #enqueue(settlement: Settlement, nodeIndex: number): void {
    const node = settlement.graph.nodes[nodeIndex]
    if (!node) return
    if (node.kind === 'effect') {
      settlement.effectIndexes.add(nodeIndex)
      return
    }
    if (node.kind !== 'computation') return
    settlement.dirtyComputations.add(nodeIndex)
    if (
      settlement.evaluatedComputations.has(nodeIndex) ||
      settlement.scheduledComputations.has(nodeIndex)
    ) {
      return
    }
    settlement.scheduledComputations.add(nodeIndex)
    heapPush(settlement.computationHeap, nodeIndex)
  }

  #enqueueSubscribers(settlement: Settlement, nodeIndex: number): void {
    const node = settlement.graph.nodes[nodeIndex]
    if (!node) return
    for (const subscriber of node.subscribers) {
      this.#enqueue(settlement, subscriber)
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

  #addNode(graph: ReactiveGraph, node: ReactiveNode): void {
    const nodeIndex = graph.nodes.length
    graph.nodeIndexes.set(node.id, nodeIndex)
    graph.nodes.push(node)
    graph.seenEpochByNode.push(0)
    ;(graph.pendingBatch as PendingBatch).createdNodeIndexes.push(nodeIndex)
  }

  #graphForCreate(graphId: string): ReactiveGraph {
    if (this.#disposedGraphIds.has(graphId)) {
      throw new Error(`Reactive graph ${graphId} is disposed`)
    }
    const existing = this.#graphs.get(graphId)
    if (existing) return existing
    const graph: ReactiveGraph = {
      id: graphId,
      nodes: [],
      nodeIndexes: new Map(),
      assignedCallbackIds: new Set(),
      settledBatchIds: new Set(),
      seenEpochByNode: [],
      openBatchId: undefined,
      pendingBatch: undefined,
    }
    this.#graphs.set(graphId, graph)
    return graph
  }

  #graphForRead(graphId: string): ReactiveGraph | undefined {
    if (this.#settlement?.graph.id === graphId) return this.#settlement.graph
    return this.#graphs.get(graphId)
  }

  #requireStoredGraph(graphId: string): ReactiveGraph {
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

  #openBatch(graph: ReactiveGraph, batchId: string): void {
    if (graph.settledBatchIds.has(batchId)) {
      throw new Error(
        `Reactive batch ${batchId} is already settled in graph ${graph.id}`,
      )
    }
    if (graph.openBatchId && graph.openBatchId !== batchId) {
      throw new Error(
        `Reactive batch ${graph.openBatchId} is already open in graph ${graph.id}`,
      )
    }
    if (!graph.openBatchId) {
      graph.openBatchId = batchId
      graph.pendingBatch = {
        createdNodeIndexes: [],
        touchedSignals: new Map(),
      }
    }
  }

  #assertEventBatch(graph: ReactiveGraph, batchId: string): void {
    if (graph.openBatchId !== batchId || !graph.pendingBatch) {
      throw new Error(
        `Malformed reactive history: batch ${batchId} is not open in graph ${graph.id}`,
      )
    }
  }

  #assertNewNode(graph: ReactiveGraph, nodeId: string): void {
    if (graph.nodeIndexes.has(nodeId)) {
      throw new Error(
        `Reactive node ${nodeId} already exists in graph ${graph.id}`,
      )
    }
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

function cloneGraph(graph: ReactiveGraph): ReactiveGraph {
  return {
    id: graph.id,
    nodes: graph.nodes.map((node) => ({
      ...node,
      dependencies: [...node.dependencies],
      subscribers: new Set(node.subscribers),
    })),
    nodeIndexes: new Map(graph.nodeIndexes),
    assignedCallbackIds: new Set(graph.assignedCallbackIds),
    settledBatchIds: new Set(graph.settledBatchIds),
    seenEpochByNode: [...graph.seenEpochByNode],
    openBatchId: graph.openBatchId,
    pendingBatch: graph.pendingBatch
      ? {
          createdNodeIndexes: [...graph.pendingBatch.createdNodeIndexes],
          touchedSignals: new Map(graph.pendingBatch.touchedSignals),
        }
      : undefined,
  }
}

function heapPush(heap: number[], value: number): void {
  heap.push(value)
  let index = heap.length - 1
  while (index > 0) {
    const parent = (index - 1) >>> 1
    if ((heap[parent] as number) <= value) break
    heap[index] = heap[parent] as number
    index = parent
  }
  heap[index] = value
}

function heapPop(heap: number[]): number | undefined {
  const first = heap[0]
  const last = heap.pop()
  if (first === undefined || last === undefined || heap.length === 0) {
    return first
  }
  let index = 0
  while (true) {
    const left = index * 2 + 1
    if (left >= heap.length) break
    const right = left + 1
    const child =
      right < heap.length && (heap[right] as number) < (heap[left] as number)
        ? right
        : left
    if ((heap[child] as number) >= last) break
    heap[index] = heap[child] as number
    index = child
  }
  heap[index] = last
  return first
}
