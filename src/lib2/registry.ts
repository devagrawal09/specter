import * as SqlClient from '@effect/sql/SqlClient'
import { Data, Effect } from 'effect'
import type * as ParseResult from 'effect/ParseResult'
import * as Schema from 'effect/Schema'

import { EventLogService, SliceStores } from './services'
import type {
  CommandEnvelope,
  CommandSlice,
  ProjectionSlice,
  ReactionExec,
  ReactionSlice,
  SliceRegistration,
} from './slice'

export class EmptyCommandRegistryError extends Data.TaggedError(
  'EmptyCommandRegistryError',
) {}

export class InvalidCommandError extends Data.TaggedError(
  'InvalidCommandError',
)<{
  readonly error: ParseResult.ParseError
}> {}

export class InvalidProjectionInputError extends Data.TaggedError(
  'InvalidProjectionInputError',
)<{
  readonly projectionName: string
  readonly error: ParseResult.ParseError
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
  return Effect.gen(function* () {
    const registry: {
      commands: Record<string, CommandSlice>
      projections: Record<string, ProjectionSlice>
      reactions: Record<string, ReactionSlice<string, unknown>>
    } = { commands: {}, projections: {}, reactions: {} }
    const sliceNames = new Set<string>()

    for (const registration of registrations) {
      if (sliceNames.has(registration.name)) {
        return yield* Effect.fail(
          new DuplicateSliceNameError({ sliceName: registration.name }),
        )
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
    }

    if (Object.keys(registry.commands).length === 0) {
      return yield* Effect.fail(new EmptyCommandRegistryError())
    }

    const reactionExecs = new Map<string, ReactionExec>()

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

        const parsedCommand = yield* Schema.decodeUnknown(commandSlice.schema)(
          c.payload,
        ).pipe(Effect.mapError((error) => new InvalidCommandError({ error })))

        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const eventLog = yield* EventLogService
            const { store } = yield* catchUpSlice(commandSlice)
            const events = yield* commandSlice.handle(
              store.state,
              parsedCommand,
            )
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
          return (payload: unknown) =>
            dispatch({
              type:
                payload && typeof payload === 'object' && 'type' in payload
                  ? String(payload.type)
                  : '',
              payload:
                payload && typeof payload === 'object' && 'payload' in payload
                  ? payload.payload
                  : undefined,
            })
        }
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

          if (!registration) {
            return yield* Effect.fail(
              new UnknownProjectionError({ projectionName }),
            )
          }

          const parsedInput = yield* Schema.decodeUnknown(registration.schema)(
            input,
          ).pipe(
            Effect.mapError(
              (error) =>
                new InvalidProjectionInputError({ projectionName, error }),
            ),
          )

          const sql = yield* SqlClient.SqlClient
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              const { store } = yield* catchUpSlice(registration)
              return yield* registration.handle(store.state, parsedInput)
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
  })
}
