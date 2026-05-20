import { Effect } from 'effect'

import type { Event, PersistedEvent } from './event'
import { EventLogService, SliceStates } from './services'
import type {
  CommandEnvelope,
  CommandSlice,
  ProjectionSlice,
  ReactionSlice,
  SliceRegistration,
} from './slice'

export type CommandScenario<TPayload = unknown> = {
  given: readonly Event[]
  when: TPayload
  expect: readonly Event[]
}

export type ProjectionScenario<TWhen = unknown, TExpect = unknown> = {
  given: readonly Event[]
  when: TWhen
  expect: TExpect
}

export type ReactionScenario = {
  given: readonly Event[]
  expect: readonly CommandEnvelope[]
}

export function decideCommand(slice: CommandSlice, scenario: CommandScenario) {
  return Effect.gen(function* () {
    yield* replay([slice], autoOrder(scenario.given))

    const eventLog = yield* EventLogService
    const sliceStates = yield* SliceStates
    const state = sliceStates.create(slice.name, slice.json === true)

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
                yield* handler(event, state.input as never)
              }

              yield* state.setLastAppliedOrder(event.order)
            }),
        )

        yield* state.commit
      }
    }

    return yield* slice.decide(scenario.when as never, state.input as never)
  })
}

export function queryProjection(
  slice: ProjectionSlice,
  scenario: ProjectionScenario,
) {
  return Effect.gen(function* () {
    yield* replay([slice], autoOrder(scenario.given))

    const eventLog = yield* EventLogService
    const sliceStates = yield* SliceStates
    const state = sliceStates.create(slice.name, slice.json === true)

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
                yield* handler(event, state.input as never)
              }

              yield* state.setLastAppliedOrder(event.order)
            }),
        )

        yield* state.commit
      }
    }

    return yield* slice.query(
      state.input as never,
      slice.schema.parse(scenario.when),
    )
  })
}

export function reactToScenario(
  slice: ReactionSlice,
  scenario: ReactionScenario,
) {
  return Effect.gen(function* () {
    yield* replay([slice], autoOrder(scenario.given))

    const eventLog = yield* EventLogService
    const sliceStates = yield* SliceStates
    const state = sliceStates.create(slice.name, slice.json === true)

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
                yield* handler(event, state.input as never)
              }

              yield* state.setLastAppliedOrder(event.order)
            }),
        )

        yield* state.commit
      }
    }

    return yield* slice.react(state.input as never)
  })
}

export function replay(
  registrations: readonly SliceRegistration[],
  events: readonly PersistedEvent[],
) {
  return Effect.gen(function* () {
    const sliceStates = yield* SliceStates

    yield* Effect.forEach(events, (event) =>
      Effect.forEach(
        registrations.filter(
          (registration) => registration.apply?.[event.type],
        ),
        (registration) =>
          Effect.gen(function* () {
            const state = sliceStates.create(
              registration.name,
              registration.json === true,
            )
            const handler = registration.apply?.[event.type]

            if (handler) {
              yield* handler(event, state.input as never)
            }

            yield* state.setLastAppliedOrder(event.order)
            yield* state.commit
          }),
      ),
    )
  })
}

export function autoOrder(events: readonly Event[]) {
  return events.map((event, index) => ({
    ...event,
    order: index + 1,
  })) as PersistedEvent[]
}
