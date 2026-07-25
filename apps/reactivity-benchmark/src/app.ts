import {
  reactiveEventDefinitions,
  reactiveRegistrations,
} from './features/reactivity'
import { FusedSyncRuntime } from './runtime/fused-runtime'

export function createFusedReactivityApp(): FusedSyncRuntime {
  return new FusedSyncRuntime({
    events: reactiveEventDefinitions,
    slices: reactiveRegistrations,
  })
}
