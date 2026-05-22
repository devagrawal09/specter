import * as SqlClient from '@effect/sql/SqlClient'
import { Data, Effect } from 'effect'
import type { z } from 'zod'

import { EventLogService, SliceStores } from './services'
import type {
  CommandEnvelope,
  CommandSlice,
  ProjectionSlice,
  ReactionSlice,
  SliceRegistration,
} from './slice'

export class EmptyCommandRegistryError extends Data.TaggedError(
  'EmptyCommandRegistryError',
) {}

export class InvalidCommandError extends Data.TaggedError(
  'InvalidCommandError',
)<{
  readonly error: z.ZodError
}> {}

export class InvalidProjectionInputError extends Data.TaggedError(
  'InvalidProjectionInputError',
)<{
  readonly projectionName: string
  readonly error: z.ZodError
}> {}

export class UnknownCommandError extends Data.TaggedError(
  'UnknownCommandError',
)<{
  readonly commandName: string
}> {}

export class UnknownProjectionError extends Data.TaggedError(
  'UnknownProjectionError',
)<{
  readonly projectionName: string
}> {}

export class DuplicateSliceNameError extends Data.TaggedError(
  'DuplicateSliceNameError',
)<{
  readonly sliceName: string
}> {}

export function createRegistry(registrations: readonly SliceRegistration[]) {
  const registry: {
    commands: Record<string, CommandSlice>
    projections: Record<string, ProjectionSlice>
    reactions: Record<string, ReactionSlice<string, CommandEnvelope>>
  } = { commands: {}, projections: {}, reactions: {} }

  registrations.forEach((registration) => {
    switch (registration.kind) {
      case 'command': {
        if (registry.commands[registration.name])
          throw new DuplicateSliceNameError({ sliceName: registration.name })
        registry.commands[registration.name] = registration
        break
      }
      case 'projection': {
        if (registry.projections[registration.name])
          throw new DuplicateSliceNameError({ sliceName: registration.name })
        registry.projections[registration.name] = registration
        break
      }
      case 'reaction': {
        if (registry.reactions[registration.name])
          throw new DuplicateSliceNameError({ sliceName: registration.name })
        registry.reactions[registration.name] = registration
        break
      }
    }
  })

  const reactionExecs = new Map<
    string,
    (command: CommandEnvelope) => Effect.Effect<unknown, unknown, unknown>
  >()

  function catchUpSlice(slice: SliceRegistration) {
    return Effect.gen(function* () {
      const eventLog = yield* EventLogService
      const sliceStores = yield* SliceStores
      const store = sliceStores.get(slice.name)

      const eventTypes = Object.keys(slice.apply ?? {})

      if (!eventTypes.length) {
        return { store, advanced: false } as const
      }

      const lastAppliedOrder = yield* store.lastAppliedOrder
      const unappliedEvents = yield* eventLog.readAfter(
        lastAppliedOrder,
        eventTypes,
      )

      if (!unappliedEvents.length) {
        return { store, advanced: false } as const
      }

      yield* Effect.forEach(unappliedEvents, (event) =>
        slice.apply[event.type](event, store.state),
      )

      const lastEvent = unappliedEvents[unappliedEvents.length - 1]
      yield* store.setLastAppliedOrder(lastEvent.order)

      return { store, advanced: true } as const
    })
  }

  function dispatch(c: { type: string; payload: unknown }) {
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const commandSlice = registry.commands[c.type]
      const command = commandSlice.schema.parse(c.payload)
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const eventLog = yield* EventLogService
          const { store } = yield* catchUpSlice(commandSlice)
          const events = yield* commandSlice.handle(store.state, command)
          return yield* eventLog.append(events)
        }),
      )
    })
  }

  function getReactionExec(reaction: ReactionSlice) {
    return Effect.gen(function* () {
      const cachedExec = reactionExecs.get(reaction.name)
      if (cachedExec) return cachedExec
      if (!reaction.plugin) return dispatch
      const exec = yield* reaction.plugin(dispatch)
      reactionExecs.set(reaction.name, exec)
      return exec
    })
  }

  return {
    dispatch,
    query: (projectionName: string, input: unknown) =>
      Effect.gen(function* () {
        const registration = registry.projections[projectionName]
        const sql = yield* SqlClient.SqlClient
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const { store } = yield* catchUpSlice(registration)
            return yield* registration.handle(
              store.state,
              registration.schema.parse(input),
            )
          }),
        )
      }),
    runReactions: () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const results = yield* Effect.forEach(
          Object.values(registry.reactions),
          (reaction) =>
            sql.withTransaction(
              Effect.gen(function* () {
                const { store, advanced } = yield* catchUpSlice(reaction)
                if (!advanced) return false
                const effect = yield* reaction.handle(store.state)
                if (!effect) return false
                const exec = yield* getReactionExec(reaction)
                yield* exec(effect)
                return true
              }),
            ),
        )
        if (results.some((r) => r)) return true
        return false
      }),
  }
}
