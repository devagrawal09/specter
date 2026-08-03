import { FusedCommandRejectedError } from '../../../runtime/fused-runtime'
import { implementFusedCommand } from '../../../runtime/fused-slices'
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
import type { SettleReactiveBatchInput } from '../model'
import {
  applyReactiveEvent,
  ReactiveCallbackEvaluationError,
  reactiveStore,
} from '../state'
import specification from './spec.json' with { type: 'json' }

export const settleReactiveBatch = implementFusedCommand(specification)
  .inputSchema<SettleReactiveBatchInput>()
  .store(reactiveStore)
  .apply(reactiveSignalCreatedEvent, applyReactiveEvent)
  .apply(reactiveComputationCreatedEvent, applyReactiveEvent)
  .apply(reactiveEffectCreatedEvent, applyReactiveEvent)
  .apply(reactiveComputationEvaluatedEvent, applyReactiveEvent)
  .apply(reactiveEffectExecutedEvent, applyReactiveEvent)
  .apply(reactiveBatchSettledEvent, applyReactiveEvent)
  .apply(reactiveSignalWrittenEvent, applyReactiveEvent)
  .apply(reactiveGraphDisposedEvent, applyReactiveEvent)
  .handle((command, state, context) => {
    if (state.isDisposed(command.graphId)) {
      throw new FusedCommandRejectedError(
        `Reactive graph ${command.graphId} is disposed`,
      )
    }
    if (state.isBatchSettled(command.graphId, command.batchId)) {
      throw new FusedCommandRejectedError(
        `Reactive batch ${command.batchId} is already settled in graph ${command.graphId}`,
      )
    }
    if (!state.hasGraph(command.graphId)) {
      throw new FusedCommandRejectedError(
        `Reactive graph ${command.graphId} was not found`,
      )
    }
    const openBatchId = state.openBatchId(command.graphId)
    if (openBatchId && openBatchId !== command.batchId) {
      throw new FusedCommandRejectedError(
        `Reactive batch ${command.batchId} is not the open batch in graph ${command.graphId}`,
      )
    }
    if (!state.hasPendingBatch(command.graphId, command.batchId)) {
      throw new FusedCommandRejectedError(
        `Reactive batch ${command.batchId} has no pending work in graph ${command.graphId}`,
      )
    }
    try {
      for (const event of state.settle(command.graphId, command.batchId)) {
        context.emit(event)
      }
    } catch (error) {
      if (error instanceof ReactiveCallbackEvaluationError) {
        throw new FusedCommandRejectedError(error.message)
      }
      throw error
    }
  })

export default settleReactiveBatch
