import * as SqlClient from '@effect/sql/SqlClient'
import { Data, Effect } from 'effect'
import { z } from 'zod'

import { EventLogService, SliceStates } from './services'
import type {
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

export class DuplicateCommandNameError extends Data.TaggedError(
  'DuplicateCommandNameError',
)<{
  readonly commandName: string
}> {}

export class DuplicateSliceNameError extends Data.TaggedError(
  'DuplicateSliceNameError',
)<{
  readonly sliceName: string
}> {}

export function createRegistry(registrations: readonly SliceRegistration[]) {
  const commands = registrations.filter(
    (slice): slice is CommandSlice => slice.kind === 'command',
  )
  const projections = registrations.filter(
    (slice): slice is ProjectionSlice => slice.kind === 'projection',
  )
  const reactions = registrations.filter(
    (slice): slice is ReactionSlice => slice.kind === 'reaction',
  )

  const duplicateCommandName = commands.find(
    (command, index) =>
      commands.findIndex((candidate) => candidate.name === command.name) !==
      index,
  )?.name

  const duplicateSliceName = registrations.find(
    (registration, index) =>
      registrations.findIndex(
        (candidate) => candidate.name === registration.name,
      ) !== index,
  )?.name

  if (duplicateCommandName) {
    throw new DuplicateCommandNameError({
      commandName: duplicateCommandName,
    })
  }

  if (duplicateSliceName) {
    throw new DuplicateSliceNameError({ sliceName: duplicateSliceName })
  }

  function catchUpSlice(slice: SliceRegistration) {
    return Effect.gen(function* () {
      const eventLog = yield* EventLogService
      const sliceStates = yield* SliceStates
      const state = sliceStates.create(slice.name)

      const eventTypes = Object.keys(slice.apply)

      if (!eventTypes.length) {
        return { state, advanced: false } as const
      }

      const lastAppliedOrder = yield* state.lastAppliedOrder
      const unappliedEvents = yield* eventLog.readAfter(
        lastAppliedOrder,
        eventTypes,
      )

      if (!unappliedEvents.length) {
        return { state, advanced: false } as const
      }

      yield* Effect.forEach(unappliedEvents, (event) =>
        Effect.gen(function* () {
          yield* slice.apply[event.type](event, state.input)
        }),
      )

      const lastEvent = unappliedEvents[unappliedEvents.length - 1]
      yield* state.setLastAppliedOrder(lastEvent.order)

      return { state, advanced: true } as const
    })
  }

  const dispatch = (c: unknown) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const firstCommand = commands[0]

      if (!firstCommand) {
        return yield* Effect.fail(new EmptyCommandRegistryError())
      }

      const commandInput = z.discriminatedUnion('name', [
        z.object({
          name: z.literal(firstCommand.name),
          payload: firstCommand.schema,
        }),
        ...commands.slice(1).map((command) =>
          z.object({
            name: z.literal(command.name),
            payload: command.schema,
          }),
        ),
      ])
      const initialCommand = commandInput.safeParse(c)

      if (!initialCommand.success) {
        return yield* Effect.fail(
          new InvalidCommandError({ error: initialCommand.error }),
        )
      }

      const result = yield* sql.withTransaction(
        Effect.gen(function* () {
          const commandSlice = commands.find(
            (slice) => slice.name === initialCommand.data.name,
          )

          if (!commandSlice) {
            return yield* Effect.fail(
              new UnknownCommandError({
                commandName: initialCommand.data.name,
              }),
            )
          }

          const eventLog = yield* EventLogService
          const sliceStates = yield* SliceStates
          const commandState = sliceStates.create(commandSlice.name)

          if (commandSlice.apply) {
            const eventTypes = Object.keys(commandSlice.apply)

            if (eventTypes.length > 0) {
              const lastAppliedOrder = yield* commandState.lastAppliedOrder

              yield* Effect.forEach(
                yield* eventLog.readAfter(lastAppliedOrder, eventTypes),
                (event) =>
                  Effect.gen(function* () {
                    const apply = commandSlice.apply?.[event.type]

                    if (apply) {
                      yield* apply(event, commandState.input)
                      yield* commandState.setLastAppliedOrder(event.order)
                    }
                  }),
              )
            }
          }

          const events = yield* commandSlice.decide(
            initialCommand.data.payload,
            commandState.input,
          )

          return yield* eventLog.append(events)
        }),
      )

      return result
    })

  function runReactions() {
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const firstCommand = commands[0]

      if (!firstCommand) {
        return yield* Effect.fail(new EmptyCommandRegistryError())
      }

      const results = yield* Effect.forEach(reactions, (reaction) =>
        sql.withTransaction(
          Effect.gen(function* () {
            if (!reaction.apply) {
              return { advanced: false, events: [] }
            }

            const eventTypes = Object.keys(reaction.apply)

            if (eventTypes.length === 0) {
              return { advanced: false, events: [] }
            }

            const { state, advanced } = yield* catchUpSlice(reaction)

            if (!advanced) {
              return { advanced: false, events: [] }
            }

            const reactionCommands = yield* reaction.react(state)

            const persistedResults = yield* Effect.forEach(
              reactionCommands,
              dispatch,
            )

            return {
              advanced: true,
              events: persistedResults.flat(),
            }
          }),
        ),
      )

      return {
        advanced: results.some((result) => result.advanced),
        events: results.flatMap((result) => result.events),
      }
    })
  }

  function query(projectionName: string, input: unknown) {
    return Effect.gen(function* () {
      const registration = projections.find(
        (projection) => projection.name === projectionName,
      )

      if (!registration) {
        return yield* Effect.fail(
          new UnknownProjectionError({ projectionName }),
        )
      }

      const sql = yield* SqlClient.SqlClient

      const result = yield* sql.withTransaction(
        Effect.gen(function* () {
          const { state } = yield* catchUpSlice(registration)

          const parsedInput = registration.schema.safeParse(input)

          if (!parsedInput.success) {
            return yield* Effect.fail(
              new InvalidProjectionInputError({
                projectionName,
                error: parsedInput.error,
              }),
            )
          }

          return yield* registration.query(state.input, parsedInput.data)
        }),
      )

      return result
    })
  }

  return { dispatch, query, runReactions }
}
