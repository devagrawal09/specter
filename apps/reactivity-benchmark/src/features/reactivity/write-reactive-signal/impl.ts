import { FusedCommandRejectedError } from '../../../runtime/fused-runtime'
import { implementFusedCommand } from '../../../runtime/fused-slices'
import {
  reactiveBatchSettledEvent,
  reactiveComputationCreatedEvent,
  reactiveEffectCreatedEvent,
  reactiveGraphDisposedEvent,
  reactiveSignalCreatedEvent,
  reactiveSignalWrittenEvent,
} from '../events'
import type { WriteReactiveSignalInput } from '../model'
import { applyReactiveEvent, reactiveStore } from '../state'
import specification from './spec.json' with { type: 'json' }

export const writeReactiveSignal = implementFusedCommand(specification)
  .inputSchema<WriteReactiveSignalInput>()
  .store(reactiveStore)
  .apply(reactiveSignalCreatedEvent, applyReactiveEvent)
  .apply(reactiveSignalWrittenEvent, applyReactiveEvent)
  .apply(reactiveComputationCreatedEvent, applyReactiveEvent)
  .apply(reactiveEffectCreatedEvent, applyReactiveEvent)
  .apply(reactiveBatchSettledEvent, applyReactiveEvent)
  .apply(reactiveGraphDisposedEvent, applyReactiveEvent)
  .handle((command, state, context) => {
    if (state.isSettling(command.graphId)) {
      throw new FusedCommandRejectedError(
        `Reactive callbacks cannot write in graph ${command.graphId}`,
      )
    }
    const batchRejection = state.mutationRejection(
      command.graphId,
      command.batchId,
    )
    if (batchRejection) throw new FusedCommandRejectedError(batchRejection)
    const kind = state.nodeKind(command.graphId, command.nodeId)
    if (kind === undefined) {
      throw new FusedCommandRejectedError(
        `Reactive signal ${command.nodeId} was not found in graph ${command.graphId}`,
      )
    }
    if (kind !== 'signal') {
      throw new FusedCommandRejectedError(
        `Reactive node ${command.nodeId} is not a signal`,
      )
    }
    const result = state.nodeValue(command.graphId, command.nodeId)
    if (result.status !== 'batch-open' && result.status !== 'available') {
      throw new FusedCommandRejectedError(
        `Reactive signal ${command.nodeId} was not found in graph ${command.graphId}`,
      )
    }
    const previousValue =
      result.status === 'available'
        ? result.value
        : state.signalValue(command.graphId, command.nodeId)
    context.emit(
      reactiveSignalWrittenEvent.create({
        ...command,
        previousValue,
        changed: !Object.is(previousValue, command.value),
      }),
    )
  })

export default writeReactiveSignal
