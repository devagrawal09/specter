import { Context, Effect } from 'effect'

import type { SliceRegistration } from '../definition'

export type SpecterEventReference = {
  readonly id: string
  readonly type: string
  readonly order: number
  readonly recordedAt: string
  readonly commitVersion?: number
}

export type SpecterCausality = {
  readonly correlationId?: string
  readonly parentOperationIds: readonly string[]
  readonly causedByEvents: readonly SpecterEventReference[]
  readonly triggeringEventIds?: readonly string[]
  readonly triggeringEventOrder?: { readonly from: number; readonly to: number }
}

export const SpecterObservationCausality = Context.Reference<SpecterCausality>(
  '@specter-ts/core/SpecterObservationCausality',
  {
    defaultValue: () => ({
      parentOperationIds: [],
      causedByEvents: [],
    }),
  },
)

type SpecterObservationBase = SpecterCausality & {
  readonly observationId: string
  readonly observedAt: string
  readonly operationId: string
}

export type SpecterObservation = SpecterObservationBase &
  (
    | { readonly type: 'command-started'; readonly commandType: string }
    | {
        readonly type: 'command-completed'
        readonly commandType: string
        readonly version: number
        readonly events: readonly SpecterEventReference[]
        readonly duplicate: boolean
        readonly durationMs: number
      }
    | {
        readonly type: 'command-rejected' | 'command-failed'
        readonly commandType: string
        readonly durationMs: number
        readonly cause: unknown
      }
    | {
        readonly type: 'event-persisted'
        readonly event: SpecterEventReference
      }
    | {
        readonly type: 'query-started'
        readonly queryName: string
        readonly subscription: boolean
      }
    | {
        readonly type: 'query-completed'
        readonly queryName: string
        readonly subscription: boolean
        readonly durationMs: number
      }
    | {
        readonly type: 'query-rejected' | 'query-failed'
        readonly queryName: string
        readonly subscription: boolean
        readonly durationMs: number
        readonly cause: unknown
      }
    | {
        readonly type: 'slice-caught-up'
        readonly sliceName: string
        readonly sliceKind: SliceRegistration['kind']
        readonly fromOrder: number
        readonly toOrder: number
        readonly eventCount: number
        readonly events: readonly SpecterEventReference[]
      }
    | {
        readonly type: 'subscriptions-invalidated'
        readonly queryName: string
        readonly subscriberCount: number
        readonly changedEventTypes: readonly string[]
      }
    | {
        readonly type: 'reaction-run-started'
        readonly reactionName: string
        readonly deliveryId: string
        readonly commitVersion: number
      }
    | {
        readonly type: 'reaction-run-completed' | 'reaction-run-failed'
        readonly reactionName: string
        readonly deliveryId: string
        readonly commitVersion: number
        readonly durationMs: number
        readonly cause?: unknown
      }
  )

export type SpecterObservationDetails = SpecterObservation extends infer TEvent
  ? TEvent extends SpecterObservationBase
    ? Omit<TEvent, keyof SpecterObservationBase>
    : never
  : never

export type SpecterObserverService = {
  readonly observe: (observation: SpecterObservation) => Effect.Effect<void>
}

export function createPrettyConsoleSpecterObserver(): SpecterObserverService {
  return {
    observe: (observation) =>
      Effect.sync(() => {
        console.log(`[specter] ${observation.type}`, observation)
      }),
  }
}

export const SpecterObserver = Context.Reference<SpecterObserverService>(
  '@specter-ts/core/SpecterObserver',
  {
    defaultValue: () => ({
      observe: () => Effect.void,
    }),
  },
)

export type SpecterIdService = {
  readonly next: Effect.Effect<string>
}

export const SpecterIds = Context.Reference<SpecterIdService>(
  '@specter-ts/core/SpecterIds',
  {
    defaultValue: () => ({
      next: Effect.sync(() => globalThis.crypto.randomUUID()),
    }),
  },
)
