import { implementFusedQuery } from '../../../runtime/fused-slices'
import {
  reactiveBatchSettledEvent,
  reactiveComputationCreatedEvent,
  reactiveComputationEvaluatedEvent,
  reactiveEffectCreatedEvent,
  reactiveEffectExecutedEvent,
  reactiveGraphDisposedEvent,
  reactiveSignalCreatedEvent,
  reactiveSignalWrittenEvent,
} from '../events'
import type { ReactiveNodeInput, ReactiveNodeValue } from '../model'
import { applyReactiveEvent, reactiveStore } from '../state'
import specification from './spec.json' with { type: 'json' }

export const reactiveNodeValue = implementFusedQuery(specification)
  .inputSchema<ReactiveNodeInput>()
  .outputSchema<ReactiveNodeValue>()
  .store(reactiveStore)
  .apply(reactiveSignalCreatedEvent, applyReactiveEvent)
  .apply(reactiveSignalWrittenEvent, applyReactiveEvent)
  .apply(reactiveComputationCreatedEvent, applyReactiveEvent)
  .apply(reactiveComputationEvaluatedEvent, applyReactiveEvent)
  .apply(reactiveEffectCreatedEvent, applyReactiveEvent)
  .apply(reactiveEffectExecutedEvent, applyReactiveEvent)
  .apply(reactiveBatchSettledEvent, applyReactiveEvent)
  .apply(reactiveGraphDisposedEvent, applyReactiveEvent)
  .handle((query, state) => state.nodeValue(query.graphId, query.nodeId))

export default reactiveNodeValue
