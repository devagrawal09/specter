import { createMemorySliceStoreLayer } from '@specter-ts/memory'
import { Layer } from 'effect'

import { sessionEventDefinitions } from './events.ts'
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

export const sessionRegistrations = {
  enqueueInput,
  cancelInboxItem,
  nextDeliverable,
  deliverInboxItem,
  startExecution,
  interruptExecution,
  wakeExecution,
  executionStatus,
} as const

export const sessionAppConfig = {
  events: sessionEventDefinitions,
  slices: sessionRegistrations,
} as const

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
)
