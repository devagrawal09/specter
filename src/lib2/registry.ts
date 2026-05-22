import * as SqlClient from '@effect/sql/SqlClient'
import { Data, Effect } from 'effect'
import type { ZodError } from 'zod'

import { EventLogService, SliceStores } from './services'
import type { Event } from './event'
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
  readonly error: ZodError
}> {}

export class InvalidProjectionInputError extends Data.TaggedError(
  'InvalidProjectionInputError',
)<{
  readonly projectionName: string
  readonly error: ZodError
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
    reactions: Record<string, ReactionSlice<string, unknown>>
  } = { commands: {}, projections: {}, reactions: {} }
  const sliceNames = new Set<string>()

  registrations.forEach((registration) => {
    if (sliceNames.has(registration.name)) {
      throw new DuplicateSliceNameError({ sliceName: registration.name })
    }

    sliceNames.add(registration.name)

    switch (registration.kind) {
      case 'command': {
        registry.commands[registration.name] = registration
        break
      }
      case 'projection': {
        registry.projections[registration.name] = registration
        break
      }
      case 'reaction': {
        registry.reactions[registration.name] = registration
        break
      }
    }
  })

  const reactionExecs = new Map<
    string,
    (command: unknown) => Effect.Effect<unknown, unknown, unknown>
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

  function dispatch(c: CommandEnvelope) {
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const commandSlice = registry.commands[c.type]

      if (!commandSlice) {
        return yield* Effect.fail(
          new UnknownCommandError({ commandName: c.type }),
        )
      }

      const parsedCommand = commandSlice.schema.safeParse(c.payload)

      if (!parsedCommand.success) {
        return yield* Effect.fail(
          new InvalidCommandError({ error: parsedCommand.error }),
        )
      }

      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const eventLog = yield* EventLogService
          const { store } = yield* catchUpSlice(commandSlice)
          const events = yield* commandSlice.handle(
            store.state,
            parsedCommand.data,
          ) as Effect.Effect<Event[], unknown, never>
          return yield* eventLog.append(events)
        }),
      )
    })
  }

  function getReactionExec(reaction: ReactionSlice<string, unknown>) {
    return Effect.gen(function* () {
      const cachedExec = reactionExecs.get(reaction.name)
      if (cachedExec) return cachedExec
      if (!reaction.plugin) {
        return (payload: unknown) => dispatch(payload as CommandEnvelope)
      }
      const exec = yield* reaction.plugin(dispatch) as Effect.Effect<
        (command: unknown) => Effect.Effect<unknown, unknown, never>,
        unknown,
        never
      >
      reactionExecs.set(reaction.name, exec)
      return exec
    })
  }

  return {
    dispatch,
    query: (projectionName: string, input: unknown) =>
      Effect.gen(function* () {
        const registration = registry.projections[projectionName]

        if (!registration) {
          return yield* Effect.fail(
            new UnknownProjectionError({ projectionName }),
          )
        }

        const parsedInput = registration.schema.safeParse(input)

        if (!parsedInput.success) {
          return yield* Effect.fail(
            new InvalidProjectionInputError({
              projectionName,
              error: parsedInput.error,
            }),
          )
        }

        const sql = yield* SqlClient.SqlClient
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const { store } = yield* catchUpSlice(registration)
            return yield* registration.handle(
              store.state,
              parsedInput.data,
            ) as Effect.Effect<unknown, unknown, never>
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
                const effect = yield* reaction.handle(
                  store.state,
                ) as Effect.Effect<unknown, unknown, never>
                if (!effect) return false
                const exec = yield* getReactionExec(reaction)
                yield* exec(effect) as Effect.Effect<unknown, unknown, never>
                return true
              }),
            ),
        )
        if (results.some((r) => r)) return true
        return false
      }),
  }
}
