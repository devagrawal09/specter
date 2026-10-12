import { createMemoryReactionOutboxStore } from './memory-store'
import {
  type ReactionOutboxConformancePayload,
  testReactionOutboxStore,
} from './testing'

testReactionOutboxStore('memory', () =>
  createMemoryReactionOutboxStore<ReactionOutboxConformancePayload>(),
)
