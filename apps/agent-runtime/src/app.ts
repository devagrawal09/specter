import { createMemorySliceStoreLayer } from '@specter-ts/memory'
import {
  createMemoryReactionOutboxStore,
  type OutboxedReaction,
  type ReactionOutboxPluginOptions,
  type ReactionOutboxStore,
  withReactionOutbox,
} from '@specter-ts/reaction-outbox'
import type { SliceStoreService, SliceStoreTag } from '@specter-ts/core'
import { Layer } from 'effect'

import { sessionEventDefinitions } from './events.ts'
import { makeRunStepPlugin, type RunStepOptions } from './plugins/run-step.ts'
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
  createRecordTextState,
  recordText,
  recordTextStore,
} from './features/session/record-text/impl.ts'
import {
  createRecordToolCallState,
  recordToolCall,
  recordToolCallStore,
} from './features/session/record-tool-call/impl.ts'
import {
  createRecordToolResultState,
  recordToolResult,
  recordToolResultStore,
} from './features/session/record-tool-result/impl.ts'
import {
  createRecordStepFailedState,
  recordStepFailed,
  recordStepFailedStore,
} from './features/session/record-step-failed/impl.ts'
import {
  createForkSessionState,
  forkSession,
  forkSessionStore,
} from './features/session/fork-session/impl.ts'
import {
  createSessionHistoryState,
  sessionHistory,
  sessionHistoryStore,
} from './features/session/session-history-query/impl.ts'
import {
  createModelTranscriptState,
  modelTranscript,
  modelTranscriptStore,
} from './features/session/model-transcript-query/impl.ts'
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
  createRecordSessionFactsState,
  recordSessionFacts,
  recordSessionFactsStore,
} from './features/session/record-session-facts/impl.ts'
import {
  createRegisterSessionState,
  registerSession,
  registerSessionStore,
} from './features/session/register-session/impl.ts'
import {
  createStartExecutionState,
  startExecution,
  startExecutionStore,
} from './features/session/start-execution/impl.ts'
import {
  createStageRevertState,
  stageRevert,
  stageRevertStore,
} from './features/session/stage-revert/impl.ts'
import {
  createClearRevertState,
  clearRevert,
  clearRevertStore,
} from './features/session/clear-revert/impl.ts'
import {
  createCommitRevertState,
  commitRevert,
  commitRevertStore,
} from './features/session/commit-revert/impl.ts'
import {
  createRevertStatusState,
  revertStatus,
  revertStatusStore,
} from './features/session/revert-status-query/impl.ts'
import {
  createWakeExecutionState,
  wakeExecution,
  wakeExecutionStore,
} from './features/session/wake-execution-reaction/impl.ts'

export type RunStepOutboxStore = ReactionOutboxStore<
  OutboxedReaction<RunStepRequest>
>

// Worker tuning (lease, heartbeat, backoff, shutdown wait) for the step
// Plugin's outbox; defaults are the outbox's own.
export type RunStepOutboxOptions = Omit<
  ReactionOutboxPluginOptions<RunStepRequest>,
  'store'
>

// The step Reaction's Plugin is outboxed, so the composing app supplies the
// outbox store (memory in tests; a persistent store when the Event Log is).
export const createSessionAppConfig = (
  runStepOutbox: RunStepOutboxStore,
  outboxOptions: RunStepOutboxOptions = {},
  stepOptions: RunStepOptions = {},
) =>
  ({
    events: sessionEventDefinitions,
    slices: {
      recordSessionFacts,
      registerSession,
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
      recordText,
      recordToolCall,
      recordToolResult,
      finishExecution,
      stepStatus,
      forkSession,
      sessionHistory,
      modelTranscript,
      stageRevert,
      clearRevert,
      commitRevert,
      revertStatus,
      runStep: createRunStep(
        withReactionOutbox(makeRunStepPlugin(stepOptions), {
          ...outboxOptions,
          store: runStepOutbox,
        }),
      ),
    },
  }) as const

// Used by the per-Slice scenario tests, which never run Plugins; the
// integration test builds its own config around an outbox store it inspects.
export const sessionAppConfig = createSessionAppConfig(
  createMemoryReactionOutboxStore(),
)
export const sessionRegistrations = sessionAppConfig.slices

// Every Slice owns its own projection store; an adapter composition supplies
// how one store is provided (memory here, JSONL in app.jsonl.ts).
export type ProvideSliceStore = <TIdentifier, TWriteState, TReadState>(
  tag: SliceStoreTag<
    TIdentifier,
    SliceStoreService<TReadState, TWriteState, unknown>
  >,
  createState: () => TWriteState,
) => Layer.Layer<TIdentifier>

export const createSliceStoreLayer = (provide: ProvideSliceStore) =>
  Layer.mergeAll(
    provide(recordSessionFactsStore, createRecordSessionFactsState),
    provide(registerSessionStore, createRegisterSessionState),
    provide(enqueueInputStore, createEnqueueInputState),
    provide(cancelInboxItemStore, createCancelInboxItemState),
    provide(nextDeliverableStore, createNextDeliverableState),
    provide(deliverInboxItemStore, createDeliverInboxItemState),
    provide(startExecutionStore, createStartExecutionState),
    provide(interruptExecutionStore, createInterruptExecutionState),
    provide(wakeExecutionStore, createWakeExecutionState),
    provide(executionStatusStore, createExecutionStatusState),
    provide(recordStepStartedStore, createRecordStepStartedState),
    provide(recordStepEndedStore, createRecordStepEndedState),
    provide(recordStepFailedStore, createRecordStepFailedState),
    provide(recordTextStore, createRecordTextState),
    provide(recordToolCallStore, createRecordToolCallState),
    provide(recordToolResultStore, createRecordToolResultState),
    provide(finishExecutionStore, createFinishExecutionState),
    provide(stepStatusStore, createStepStatusState),
    provide(forkSessionStore, createForkSessionState),
    provide(sessionHistoryStore, createSessionHistoryState),
    provide(modelTranscriptStore, createModelTranscriptState),
    provide(stageRevertStore, createStageRevertState),
    provide(clearRevertStore, createClearRevertState),
    provide(commitRevertStore, createCommitRevertState),
    provide(revertStatusStore, createRevertStatusState),
    provide(runStepStore, createRunStepState),
  )

// Fresh in-memory state per Layer scope.
export const memorySliceStoreLayer = createSliceStoreLayer(
  createMemorySliceStoreLayer,
)
