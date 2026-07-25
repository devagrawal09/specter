import { FusedCommandRejectedError } from '../../../runtime/fused-runtime'
import { implementFusedCommand } from '../../../runtime/fused-slices'
import {
  reactiveComputationCreatedEvent,
  reactiveEffectCreatedEvent,
  reactiveGraphDisposedEvent,
  reactiveSignalCreatedEvent,
} from '../events'
import type { CreateReactiveCallbackNodeInput } from '../model'
import { applyReactiveEvent, reactiveStore } from '../state'
import specification from './spec.json' with { type: 'json' }

export const createReactiveComputation = implementFusedCommand(specification)
  .inputSchema<CreateReactiveCallbackNodeInput>()
  .store(reactiveStore)
  .apply(reactiveSignalCreatedEvent, applyReactiveEvent)
  .apply(reactiveComputationCreatedEvent, applyReactiveEvent)
  .apply(reactiveEffectCreatedEvent, applyReactiveEvent)
  .apply(reactiveGraphDisposedEvent, applyReactiveEvent)
  .handle((command, state, context) => {
    if (state.isDisposed(command.graphId)) {
      throw new FusedCommandRejectedError(
        `Reactive graph ${command.graphId} is disposed`,
      )
    }
    if (state.hasNode(command.graphId, command.nodeId)) {
      throw new FusedCommandRejectedError(
        `Reactive node ${command.nodeId} already exists in graph ${command.graphId}`,
      )
    }
    context.emit(reactiveComputationCreatedEvent.create(command))
  })

export default createReactiveComputation
