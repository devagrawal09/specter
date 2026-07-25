import { FusedCommandRejectedError } from '../../../runtime/fused-runtime'
import { implementFusedCommand } from '../../../runtime/fused-slices'
import {
  reactiveComputationCreatedEvent,
  reactiveBatchSettledEvent,
  reactiveEffectCreatedEvent,
  reactiveGraphDisposedEvent,
  reactiveSignalCreatedEvent,
} from '../events'
import type { CreateReactiveCallbackNodeInput } from '../model'
import { applyReactiveEvent, reactiveStore } from '../state'
import specification from './spec.json' with { type: 'json' }

export const createReactiveEffect = implementFusedCommand(specification)
  .inputSchema<CreateReactiveCallbackNodeInput>()
  .store(reactiveStore)
  .apply(reactiveSignalCreatedEvent, applyReactiveEvent)
  .apply(reactiveComputationCreatedEvent, applyReactiveEvent)
  .apply(reactiveEffectCreatedEvent, applyReactiveEvent)
  .apply(reactiveBatchSettledEvent, applyReactiveEvent)
  .apply(reactiveGraphDisposedEvent, applyReactiveEvent)
  .handle((command, state, context) => {
    const batchRejection = state.mutationRejection(
      command.graphId,
      command.batchId,
    )
    if (batchRejection) throw new FusedCommandRejectedError(batchRejection)
    const callbackRejection = state.callbackRejection(
      command.graphId,
      command.callbackId,
    )
    if (callbackRejection) {
      throw new FusedCommandRejectedError(callbackRejection)
    }
    if (state.hasNode(command.graphId, command.nodeId)) {
      throw new FusedCommandRejectedError(
        `Reactive node ${command.nodeId} already exists in graph ${command.graphId}`,
      )
    }
    context.emit(reactiveEffectCreatedEvent.create(command))
  })

export default createReactiveEffect
