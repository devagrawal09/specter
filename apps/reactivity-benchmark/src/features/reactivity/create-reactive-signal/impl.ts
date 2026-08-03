import { FusedCommandRejectedError } from '../../../runtime/fused-runtime'
import { implementFusedCommand } from '../../../runtime/fused-slices'
import {
  reactiveBatchSettledEvent,
  reactiveComputationCreatedEvent,
  reactiveEffectCreatedEvent,
  reactiveGraphDisposedEvent,
  reactiveSignalCreatedEvent,
} from '../events'
import type { CreateReactiveSignalInput } from '../model'
import { applyReactiveEvent, reactiveStore } from '../state'
import specification from './spec.json' with { type: 'json' }

export const createReactiveSignal = implementFusedCommand(specification)
  .inputSchema<CreateReactiveSignalInput>()
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
    if (state.hasNode(command.graphId, command.nodeId)) {
      throw new FusedCommandRejectedError(
        `Reactive node ${command.nodeId} already exists in graph ${command.graphId}`,
      )
    }
    context.emit(
      reactiveSignalCreatedEvent.create({
        graphId: command.graphId,
        batchId: command.batchId,
        nodeId: command.nodeId,
        value: command.initialValue,
      }),
    )
  })

export default createReactiveSignal
