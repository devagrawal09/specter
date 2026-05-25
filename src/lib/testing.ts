import { Effect } from 'effect'
import * as Schema from 'effect/Schema'

import type { EventDraft, PersistedEvent } from './event'
import { EventLogService, SliceStores } from './services'
import type {
  CommandEnvelope,
  CommandSlice,
  QuerySlice,
  ReactionSlice,
  SliceRegistration,
} from './slice'

export type CommandScenario<TPayload = unknown> = {
  given: readonly unknown[]
  when: TPayload
  expect: readonly unknown[]
  reject?: {
    reason: string
  }
}

export type QueryScenario<TWhen = unknown, TExpect = unknown> = {
  given: readonly unknown[]
  when: TWhen
  expect: TExpect
}

export type ReactionScenario<TPayload = CommandEnvelope> = {
  given: readonly unknown[]
  expect: readonly TPayload[]
}

export function decideCommand(slice: CommandSlice, scenario: CommandScenario) {
  return Effect.gen(function* () {
    yield* replay([slice], autoOrder(scenario.given as readonly EventDraft[]))

    const eventLog = yield* EventLogService
    const sliceStates = yield* SliceStores
    const state = sliceStates.get(slice.name)

    if (slice.apply) {
      const eventTypes = Object.keys(slice.apply).filter(
        (eventType) => slice.apply?.[eventType],
      )

      if (eventTypes.length > 0) {
        const lastAppliedOrder = yield* state.lastAppliedOrder

        yield* Effect.forEach(
          yield* eventLog.readAfter(lastAppliedOrder, eventTypes),
          (event) =>
            Effect.gen(function* () {
              const handler = slice.apply?.[event.type]

              if (handler) {
                yield* handler(event, state.state as never)
              }

              yield* state.setLastAppliedOrder(event.order)
            }),
        )
      }
    }

    return yield* slice.handle(state.state as never, scenario.when as never)
  })
}

export function querySlice(slice: QuerySlice, scenario: QueryScenario) {
  return Effect.gen(function* () {
    yield* replay([slice], autoOrder(scenario.given as readonly EventDraft[]))

    const eventLog = yield* EventLogService
    const sliceStates = yield* SliceStores
    const state = sliceStates.get(slice.name)

    if (slice.apply) {
      const eventTypes = Object.keys(slice.apply).filter(
        (eventType) => slice.apply?.[eventType],
      )

      if (eventTypes.length > 0) {
        const lastAppliedOrder = yield* state.lastAppliedOrder

        yield* Effect.forEach(
          yield* eventLog.readAfter(lastAppliedOrder, eventTypes),
          (event) =>
            Effect.gen(function* () {
              const handler = slice.apply?.[event.type]

              if (handler) {
                yield* handler(event, state.state as never)
              }

              yield* state.setLastAppliedOrder(event.order)
            }),
        )
      }
    }

    return yield* slice.handle(
      state.state as never,
      Schema.decodeUnknownSync(slice.schema)(scenario.when),
    )
  })
}

export function reactToScenario<TPayload>(
  slice: ReactionSlice<string, TPayload>,
  scenario: ReactionScenario<TPayload>,
): Effect.Effect<TPayload[], unknown, SliceStores> {
  return Effect.gen(function* () {
    yield* replay([slice], autoOrder(scenario.given as readonly EventDraft[]))

    const payloads: TPayload[] = []

    const sliceStates = yield* SliceStores
    const state = sliceStates.get(slice.name)

    const payload = yield* slice.handle(state.state)

    if (payload !== undefined) {
      payloads.push(payload)
    }

    return payloads
  })
}

export function replay(
  registrations: readonly SliceRegistration[],
  events: readonly PersistedEvent[],
) {
  return Effect.gen(function* () {
    const sliceStates = yield* SliceStores

    yield* Effect.forEach(events, (event) =>
      Effect.forEach(
        registrations.filter(
          (registration) => registration.apply?.[event.type],
        ),
        (registration) =>
          Effect.gen(function* () {
            const state = sliceStates.get(registration.name)
            const handler = registration.apply?.[event.type]

            if (handler) {
              yield* handler(event, state.state as never)
            }

            yield* state.setLastAppliedOrder(event.order)
          }),
      ),
    )
  })
}

export function autoOrder(events: readonly EventDraft[]) {
  return events.map((event, index) => ({
    ...event,
    id: `scenario-event-${index + 1}`,
    order: index + 1,
    recordedAt: new Date(0),
  })) satisfies PersistedEvent[]
}
