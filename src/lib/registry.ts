import * as SqlClient from '@effect/sql/SqlClient'
import { Data, Effect } from 'effect'
import type * as ParseResult from 'effect/ParseResult'
import * as Schema from 'effect/Schema'

import type { EventDraft, PersistedEvent } from './event'
import { EventLogService, SliceStores } from './services'
import type {
  CommandEnvelope,
  CommandSlice,
  SpecterAppServices,
  QuerySlice,
  ReactionExec,
  ReactionSlice,
  SliceRegistration,
} from './slice'

export class EmptyCommandSetError extends Data.TaggedError(
  'EmptyCommandSetError',
) {}

export class InvalidCommandError extends Data.TaggedError(
  'InvalidCommandError',
)<{
  readonly error: ParseResult.ParseError
}> {}

export class CommandRejectedError extends Data.TaggedError(
  'CommandRejectedError',
)<{
  readonly reason: string
}> {}

export class InvalidEventDraftError extends Data.TaggedError(
  'InvalidEventDraftError',
)<{
  readonly eventType: string
  readonly error: unknown
}> {}

export class InvalidQueryInputError extends Data.TaggedError(
  'InvalidQueryInputError',
)<{
  readonly queryName: string
  readonly error: ParseResult.ParseError
}> {}

export class UnknownCommandError extends Data.TaggedError(
  'UnknownCommandError',
)<{
  readonly commandName: string
}> {}

export class UnknownQueryError extends Data.TaggedError('UnknownQueryError')<{
  readonly queryName: string
}> {}

export class DuplicateSliceNameError extends Data.TaggedError(
  'DuplicateSliceNameError',
)<{
  readonly sliceName: string
}> {}

export class DuplicateEventTypeError extends Data.TaggedError(
  'DuplicateEventTypeError',
)<{
  readonly eventType: string
}> {}

export class UnknownEventTypeError extends Data.TaggedError(
  'UnknownEventTypeError',
)<{
  readonly eventType: string
}> {}

export class ReactionRunError extends Data.TaggedError('ReactionRunError')<{
  readonly failures: readonly {
    readonly reactionName: string
    readonly cause: unknown
  }[]
}> {}

export type SpecterAppConfig = {
  readonly events: readonly {
    readonly type: string
    readonly decode: (payload: unknown) => unknown
  }[]
  readonly slices: readonly SliceRegistration[]
}

type PreparedReactionEffect = {
  readonly reaction: ReactionSlice<string, unknown>
  readonly exec: ReactionExec
  readonly effect: unknown
}

type ReactionPreparationResult =
  | {
      readonly _tag: 'Failed'
      readonly reactionName: string
      readonly cause: unknown
    }
  | {
      readonly _tag: 'Prepared'
      readonly prepared: PreparedReactionEffect | undefined
    }

export function createSpecterApp(config: SpecterAppConfig) {
  return Effect.gen(function* () {
    const eventDefinitions: Record<
      string,
      { readonly type: string; readonly decode: (payload: unknown) => unknown }
    > = {}

    for (const eventDefinition of config.events) {
      if (eventDefinitions[eventDefinition.type]) {
        return yield* Effect.fail(
          new DuplicateEventTypeError({ eventType: eventDefinition.type }),
        )
      }

      eventDefinitions[eventDefinition.type] = eventDefinition
    }

    const slicesByKind: {
      commands: Record<string, CommandSlice>
      queries: Record<string, QuerySlice>
      reactions: Record<string, ReactionSlice<string, unknown>>
    } = { commands: {}, queries: {}, reactions: {} }
    const sliceNames = new Set<string>()

    for (const registration of config.slices) {
      if (sliceNames.has(registration.name)) {
        return yield* Effect.fail(
          new DuplicateSliceNameError({ sliceName: registration.name }),
        )
      }

      sliceNames.add(registration.name)

      switch (registration.kind) {
        case 'command': {
          slicesByKind.commands[registration.name] = registration
          break
        }
        case 'query': {
          slicesByKind.queries[registration.name] = registration
          break
        }
        case 'reaction': {
          slicesByKind.reactions[registration.name] = registration
          break
        }
      }
    }

    if (Object.keys(slicesByKind.commands).length === 0) {
      return yield* Effect.fail(new EmptyCommandSetError())
    }

    const reactionExecs = new Map<string, ReactionExec>()

    function decodePersistedEvent(event: PersistedEvent) {
      const eventDefinition = eventDefinitions[event.type]

      if (!eventDefinition) {
        return Effect.fail(new UnknownEventTypeError({ eventType: event.type }))
      }

      return Effect.succeed({
        ...event,
        payload: eventDefinition.decode(event.payload),
      })
    }

    function decodeEventDraft(
      event: EventDraft,
    ): Effect.Effect<
      EventDraft,
      UnknownEventTypeError | InvalidEventDraftError,
      never
    > {
      return Effect.gen(function* () {
        const eventDefinition = eventDefinitions[event.type]

        if (!eventDefinition) {
          return yield* Effect.fail(
            new UnknownEventTypeError({ eventType: event.type }),
          )
        }

        return yield* Effect.try({
          try: () => ({
            ...event,
            payload: eventDefinition.decode(event.payload),
          }),
          catch: (error) =>
            new InvalidEventDraftError({ eventType: event.type, error }),
        })
      })
    }

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
        const unreadEvents = yield* eventLog.readAfter(
          lastAppliedOrder,
          eventTypes,
        )
        const unappliedEvents = yield* Effect.forEach(
          unreadEvents,
          decodePersistedEvent,
        )

        if (!unappliedEvents.length) {
          return { store, advanced: false } as const
        }

        yield* Effect.forEach(unappliedEvents, (event) => {
          const apply = slice.apply[event.type]

          return apply ? apply(event, store.state) : Effect.void
        })

        const lastEvent = unappliedEvents[unappliedEvents.length - 1]
        yield* store.setLastAppliedOrder(lastEvent.order)

        return { store, advanced: true } as const
      })
    }

    for (const registration of config.slices) {
      for (const eventType of Object.keys(registration.apply ?? {})) {
        if (!eventDefinitions[eventType]) {
          return yield* Effect.fail(new UnknownEventTypeError({ eventType }))
        }
      }
    }

    function dispatch(
      c: CommandEnvelope,
    ): Effect.Effect<void, unknown, SpecterAppServices> {
      return Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const commandSlice = slicesByKind.commands[c.type]

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

            const decodedEvents = yield* Effect.forEach(
              events,
              decodeEventDraft,
            )

            yield* eventLog.append(decodedEvents)
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
      query: (queryName: string, input: unknown) =>
        Effect.gen(function* () {
          const registration = slicesByKind.queries[queryName]

          if (!registration) {
            return yield* Effect.fail(new UnknownQueryError({ queryName }))
          }

          const parsedInput = yield* Schema.decodeUnknown(registration.schema)(
            input,
          ).pipe(
            Effect.mapError(
              (error) => new InvalidQueryInputError({ queryName, error }),
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
          const reactionEffects = yield* Effect.forEach(
            Object.values(slicesByKind.reactions),
            (reaction) =>
              sql
                .withTransaction(
                  Effect.gen(function* () {
                    const { store, advanced } = yield* catchUpSlice(reaction)
                    if (!advanced) return undefined
                    const effect = yield* reaction.handle(store.state)
                    if (!effect) return undefined
                    const exec = yield* getReactionExec(reaction)
                    return {
                      reaction,
                      exec,
                      effect,
                    } satisfies PreparedReactionEffect
                  }),
                )
                .pipe(
                  Effect.match({
                    onFailure: (cause) =>
                      ({
                        _tag: 'Failed',
                        reactionName: reaction.name,
                        cause,
                      }) satisfies ReactionPreparationResult,
                    onSuccess: (prepared) =>
                      ({
                        _tag: 'Prepared',
                        prepared,
                      }) satisfies ReactionPreparationResult,
                  }),
                ),
          )
          const preparationFailures = reactionEffects.flatMap((result) =>
            result._tag === 'Failed'
              ? [{ reactionName: result.reactionName, cause: result.cause }]
              : [],
          )
          const results = yield* Effect.forEach(
            reactionEffects.flatMap((item) =>
              item._tag === 'Prepared' && item.prepared !== undefined
                ? [item.prepared]
                : [],
            ),
            ({ reaction, exec, effect }) =>
              exec(effect).pipe(
                Effect.match({
                  onFailure: (cause) => ({
                    failed: true as const,
                    reactionName: reaction.name,
                    cause,
                  }),
                  onSuccess: () => ({
                    failed: false as const,
                    reactionName: reaction.name,
                  }),
                }),
              ),
          )
          const failures = [
            ...preparationFailures,
            ...results.flatMap((result) =>
              result.failed
                ? [{ reactionName: result.reactionName, cause: result.cause }]
                : [],
            ),
          ]

          if (failures.length) {
            return yield* Effect.fail(new ReactionRunError({ failures }))
          }

          return results.length > 0
        }),
    }
  })
}
