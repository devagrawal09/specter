import * as SqlClient from '@effect/sql/SqlClient'
import { Data, Effect, Stream } from 'effect'
import { z } from 'zod'

import type { PersistedEvent } from './event'
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

  function dispatch(rawCommand: unknown) {
    return Stream.fromEffect(
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
        const initialCommand = commandInput.safeParse(rawCommand)

        if (!initialCommand.success) {
          return yield* Effect.fail(
            new InvalidCommandError({ error: initialCommand.error }),
          )
        }

        return yield* sql.withTransaction(
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
            const commandState = sliceStates.create(
              commandSlice.name,
              commandSlice.json === true,
            )

            if (commandSlice.apply) {
              const eventTypes = Object.keys(commandSlice.apply).filter(
                (eventType) => commandSlice.apply?.[eventType],
              )

              if (eventTypes.length > 0) {
                const lastAppliedOrder = yield* commandState.lastAppliedOrder

                yield* Effect.forEach(
                  yield* eventLog.readAfter(lastAppliedOrder, eventTypes),
                  (event) =>
                    Effect.gen(function* () {
                      const apply = commandSlice.apply?.[event.type]

                      if (apply) {
                        yield* apply(event, commandState.input as never)
                        yield* commandState.setLastAppliedOrder(event.order)
                      }
                    }),
                )

                yield* commandState.commit
              }
            }

            const events = yield* commandSlice.decide(
              initialCommand.data.payload as never,
              commandState.input as never,
            )

            return yield* eventLog.append(events)
          }),
        )
      }),
    ).pipe(
      Stream.flatMap((persistedEvents) =>
        Stream.concat(
          Stream.fromIterable(persistedEvents),
          Stream.fromEffect(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient

              yield* Effect.forEach(persistedEvents, (event) =>
                Effect.forEach(
                  registrations.filter((registration) => registration.eager),
                  (registration) =>
                    sql.withTransaction(
                      Effect.gen(function* () {
                        const sliceStates = yield* SliceStates
                        const state = sliceStates.create(
                          registration.name,
                          registration.json === true,
                        )
                        const apply = registration.apply?.[event.type]

                        if (apply) {
                          yield* apply(event, state.input as never)
                          yield* state.setLastAppliedOrder(event.order)
                          yield* state.commit
                        }
                      }),
                    ),
                ),
              )
            }),
          ).pipe(Stream.flatMap(() => runReactions())),
        ),
      ),
    )
  }

  function runReactions(): Stream.Stream<
    PersistedEvent,
    unknown,
    EventLogService | SliceStates | SqlClient.SqlClient
  > {
    return Stream.fromEffect(
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

        const results = yield* Effect.forEach(reactions, (reaction) =>
          sql.withTransaction(
            Effect.gen(function* () {
              if (!reaction.apply) {
                return []
              }

              const eventTypes = Object.keys(reaction.apply).filter(
                (eventType) => reaction.apply?.[eventType],
              )

              if (eventTypes.length === 0) {
                return []
              }

              const eventLog = yield* EventLogService
              const sliceStates = yield* SliceStates
              const reactionState = sliceStates.create(
                reaction.name,
                reaction.json === true,
              )
              const unappliedEvents = yield* eventLog.readAfter(
                yield* reactionState.lastAppliedOrder,
                eventTypes,
              )
              const event = unappliedEvents[0]

              if (!event) {
                return []
              }

              const apply = reaction.apply[event.type]

              if (apply) {
                yield* apply(event, reactionState.input as never)
              }

              const reactionCommands = yield* reaction.react(
                reactionState.input as never,
              )
              const persistedEvents = yield* Effect.forEach(
                reactionCommands,
                (reactionCommand) =>
                  Effect.gen(function* () {
                    const command = commandInput.safeParse(reactionCommand)

                    if (!command.success) {
                      return yield* Effect.fail(
                        new InvalidCommandError({ error: command.error }),
                      )
                    }

                    const commandSlice = commands.find(
                      (slice) => slice.name === command.data.name,
                    )

                    if (!commandSlice) {
                      return yield* Effect.fail(
                        new UnknownCommandError({
                          commandName: command.data.name,
                        }),
                      )
                    }

                    const commandState = sliceStates.create(
                      commandSlice.name,
                      commandSlice.json === true,
                    )

                    if (commandSlice.apply) {
                      const commandEventTypes = Object.keys(
                        commandSlice.apply,
                      ).filter((eventType) => commandSlice.apply?.[eventType])

                      if (commandEventTypes.length > 0) {
                        const lastAppliedOrder =
                          yield* commandState.lastAppliedOrder

                        yield* Effect.forEach(
                          yield* eventLog.readAfter(
                            lastAppliedOrder,
                            commandEventTypes,
                          ),
                          (event) =>
                            Effect.gen(function* () {
                              const commandApply =
                                commandSlice.apply?.[event.type]

                              if (commandApply) {
                                yield* commandApply(
                                  event,
                                  commandState.input as never,
                                )
                                yield* commandState.setLastAppliedOrder(
                                  event.order,
                                )
                              }
                            }),
                        )

                        yield* commandState.commit
                      }
                    }

                    const events = yield* commandSlice.decide(
                      command.data.payload as never,
                      commandState.input as never,
                    )

                    return yield* eventLog.append(events)
                  }),
              )

              yield* reactionState.setLastAppliedOrder(event.order)
              yield* reactionState.commit

              return persistedEvents.flat()
            }),
          ),
        )

        return results.flat()
      }),
    ).pipe(
      Stream.flatMap((persistedEvents) =>
        persistedEvents.length === 0
          ? Stream.empty
          : Stream.concat(
              Stream.fromIterable(persistedEvents),
              Stream.fromEffect(
                Effect.gen(function* () {
                  const sql = yield* SqlClient.SqlClient

                  yield* Effect.forEach(persistedEvents, (event) =>
                    Effect.forEach(
                      registrations.filter(
                        (registration) => registration.eager,
                      ),
                      (registration) =>
                        sql.withTransaction(
                          Effect.gen(function* () {
                            const sliceStates = yield* SliceStates
                            const state = sliceStates.create(
                              registration.name,
                              registration.json === true,
                            )
                            const apply = registration.apply?.[event.type]

                            if (apply) {
                              yield* apply(event, state.input as never)
                              yield* state.setLastAppliedOrder(event.order)
                              yield* state.commit
                            }
                          }),
                        ),
                    ),
                  )
                }),
              ).pipe(Stream.flatMap(() => runReactions())),
            ),
      ),
    )
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

      const eventLog = yield* EventLogService
      const sliceStates = yield* SliceStates
      const state = sliceStates.create(
        registration.name,
        registration.json === true,
      )

      if (registration.apply) {
        const eventTypes = Object.keys(registration.apply).filter(
          (eventType) => registration.apply?.[eventType],
        )

        if (eventTypes.length > 0) {
          const lastAppliedOrder = yield* state.lastAppliedOrder

          yield* Effect.forEach(
            yield* eventLog.readAfter(lastAppliedOrder, eventTypes),
            (event) =>
              Effect.gen(function* () {
                const handler = registration.apply?.[event.type]

                if (handler) {
                  yield* handler(event, state.input as never)
                  yield* state.setLastAppliedOrder(event.order)
                }
              }),
          )

          yield* state.commit
        }
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

      return yield* registration.query(state.input as never, parsedInput.data)
    })
  }

  return { dispatch, query, runReactions }
}
