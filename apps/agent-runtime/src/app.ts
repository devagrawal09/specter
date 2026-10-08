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

export const sessionRegistrations = {
  enqueueInput,
  cancelInboxItem,
  nextDeliverable,
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
)
