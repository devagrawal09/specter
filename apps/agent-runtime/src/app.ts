import { createMemorySliceStoreLayer } from '@specter-ts/memory'
import {
  createMemoryReactionOutboxStore,
  type OutboxedReaction,
  type ReactionOutboxStore,
  withReactionOutbox,
} from '@specter-ts/reaction-outbox'
import { Layer } from 'effect'

import { sessionEventDefinitions } from './events.ts'
import { runStepPlugin } from './plugins/run-step.ts'
import {
  createFinishExecutionState,
  finishExecution,
  finishExecutionStore,
} from './features/session/finish-execution/impl.ts'
import {
  createRecordStepEndedState,
  recordStepEnded,
  recordStepEndedStore,
} from './features/session/record-step-ended/impl.ts'
import {
  createRecordStepStartedState,
  recordStepStarted,
  recordStepStartedStore,
} from './features/session/record-step-started/impl.ts'
import {
  createRecordStepFailedState,
  recordStepFailed,
  recordStepFailedStore,
} from './features/session/record-step-failed/impl.ts'
import {
  createScheduleRetryState,
  scheduleRetry,
  scheduleRetryStore,
} from './features/session/schedule-retry/impl.ts'
import {
  createRunStep,
  createRunStepState,
  runStepStore,
  type RunStepRequest,
} from './features/session/run-step-reaction/impl.ts'
import {
  createStepStatusState,
  stepStatus,
  stepStatusStore,
} from './features/session/step-status-query/impl.ts'
import {
  cancelInboxItem,
  cancelInboxItemStore,
  createCancelInboxItemState,
} from './features/session/cancel-inbox-item/impl.ts'
import {
  enqueueInput,
  enqueueInputStore,
  createEnqueueInputState,
} from './features/session/enqueue-input/impl.ts'
import {
  createNextDeliverableState,
  nextDeliverable,
  nextDeliverableStore,
} from './features/session/next-deliverable-query/impl.ts'
import {
  createDeliverInboxItemState,
  deliverInboxItem,
  deliverInboxItemStore,
} from './features/session/deliver-inbox-item/impl.ts'
import {
  createExecutionStatusState,
  executionStatus,
  executionStatusStore,
} from './features/session/execution-status-query/impl.ts'
import {
  createInterruptExecutionState,
  interruptExecution,
  interruptExecutionStore,
} from './features/session/interrupt-execution/impl.ts'
import {
  createStartExecutionState,
  startExecution,
  startExecutionStore,
} from './features/session/start-execution/impl.ts'
import {
  createWakeExecutionState,
  wakeExecution,
  wakeExecutionStore,
} from './features/session/wake-execution-reaction/impl.ts'

export type RunStepOutboxStore = ReactionOutboxStore<
  OutboxedReaction<RunStepRequest>
>

// The step Reaction's Plugin is outboxed, so the composing app supplies the
// outbox store (memory in tests; a persistent store when the Event Log is).
export const createSessionAppConfig = (runStepOutbox: RunStepOutboxStore) =>
  ({
    events: sessionEventDefinitions,
    slices: {
      enqueueInput,
      cancelInboxItem,
      nextDeliverable,
      deliverInboxItem,
      startExecution,
      interruptExecution,
      wakeExecution,
      executionStatus,
      recordStepStarted,
      recordStepEnded,
      recordStepFailed,
      scheduleRetry,
      finishExecution,
      stepStatus,
      runStep: createRunStep(
        withReactionOutbox(runStepPlugin, { store: runStepOutbox }),
      ),
    },
  }) as const

// Used by the per-Slice scenario tests, which never run Plugins; the
// integration test builds its own config around an outbox store it inspects.
export const sessionAppConfig = createSessionAppConfig(
  createMemoryReactionOutboxStore(),
)
export const sessionRegistrations = sessionAppConfig.slices

// Each slice owns its own in-memory projection; fresh state per Layer scope.
export const memorySliceStoreLayer = Layer.mergeAll(
  createMemorySliceStoreLayer(enqueueInputStore, createEnqueueInputState),
  createMemorySliceStoreLayer(cancelInboxItemStore, createCancelInboxItemState),
  createMemorySliceStoreLayer(nextDeliverableStore, createNextDeliverableState),
  createMemorySliceStoreLayer(
    deliverInboxItemStore,
    createDeliverInboxItemState,
  ),
  createMemorySliceStoreLayer(startExecutionStore, createStartExecutionState),
  createMemorySliceStoreLayer(
    interruptExecutionStore,
    createInterruptExecutionState,
  ),
  createMemorySliceStoreLayer(wakeExecutionStore, createWakeExecutionState),
  createMemorySliceStoreLayer(executionStatusStore, createExecutionStatusState),
  createMemorySliceStoreLayer(
    recordStepStartedStore,
    createRecordStepStartedState,
  ),
  createMemorySliceStoreLayer(recordStepEndedStore, createRecordStepEndedState),
  createMemorySliceStoreLayer(
    recordStepFailedStore,
    createRecordStepFailedState,
  ),
  createMemorySliceStoreLayer(scheduleRetryStore, createScheduleRetryState),
  createMemorySliceStoreLayer(finishExecutionStore, createFinishExecutionState),
  createMemorySliceStoreLayer(stepStatusStore, createStepStatusState),
  createMemorySliceStoreLayer(runStepStore, createRunStepState),
)
