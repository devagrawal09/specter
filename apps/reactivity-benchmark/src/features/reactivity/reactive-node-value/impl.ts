import { implementFusedQuery } from '../../../runtime/fused-slices'
import {
  reactiveComputationCreatedEvent,
  reactiveComputationEvaluatedEvent,
  reactiveSignalCreatedEvent,
  reactiveSignalWrittenEvent,
} from '../events'
import type { ReactiveNodeInput, ReactiveValue } from '../model'
import { applyReactiveEvent, reactiveStore } from '../state'
import specification from './spec.json' with { type: 'json' }

export const reactiveNodeValue = implementFusedQuery(specification)
  .inputSchema<ReactiveNodeInput>()
  .outputSchema<ReactiveValue>()
  .store(reactiveStore)
  .apply(reactiveSignalCreatedEvent, applyReactiveEvent)
  .apply(reactiveSignalWrittenEvent, applyReactiveEvent)
  .apply(reactiveComputationCreatedEvent, applyReactiveEvent)
  .apply(reactiveComputationEvaluatedEvent, applyReactiveEvent)
  .handle((query, state) => state.read(query.graphId, query.nodeId))

export default reactiveNodeValue
