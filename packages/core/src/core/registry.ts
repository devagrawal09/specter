import { Data } from 'effect'
import type * as ParseResult from 'effect/ParseResult'
import * as Schema from 'effect/Schema'

import type { EventLogAdapter, SliceStore } from '../adapters/contracts'
import type { EventDraft, PersistedEvent } from './event'
import type {
  CommandEnvelope,
  CommandSlice,
  QuerySlice,
  ReactionExec,
  ReactionSlice,
  SliceRegistration,
} from './slice'
export { CommandRejectedError } from './errors'

export class EmptyCommandSetError extends Data.TaggedError(
  'EmptyCommandSetError',
) {}
export class InvalidCommandError extends Data.TaggedError(
  'InvalidCommandError',
)<{
  readonly error: ParseResult.ParseError
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
  readonly eventLog: EventLogAdapter
  readonly slices: readonly SliceRegistration[]
}

type CommandInput<TSlice> =
  TSlice extends CommandSlice<string, infer TSchema>
    ? Schema.Schema.Type<TSchema>
    : never

type QueryInput<TSlice> =
  TSlice extends QuerySlice<string, infer TSchema>
    ? Schema.Schema.Type<TSchema>
    : never

type QueryOutput<TSlice> =
  TSlice extends QuerySlice<string, Schema.Schema.AnyNoContext, infer TResult>
    ? TResult
    : never

type CommandMethods<TSlices extends readonly SliceRegistration[]> = {
  [TSlice in Extract<TSlices[number], { kind: 'command' }> as TSlice['name']]: (
    input: CommandInput<TSlice>,
  ) => Promise<void>
}

type QueryMethods<TSlices extends readonly SliceRegistration[]> = {
  [TSlice in Extract<TSlices[number], { kind: 'query' }> as TSlice['name']]: (
    input: QueryInput<TSlice>,
  ) => Promise<QueryOutput<TSlice>>
}

export type SpecterApp<TConfig extends SpecterAppConfig> = CommandMethods<
  TConfig['slices']
> &
  QueryMethods<TConfig['slices']> & {
    readonly runtime: {
      runReactions: () => Promise<boolean>
    }
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

export function createSpecterApp<const TConfig extends SpecterAppConfig>(
  config: TConfig,
): SpecterApp<TConfig> {
  const eventDefinitions: Record<
    string,
    { readonly type: string; readonly decode: (payload: unknown) => unknown }
  > = {}

  for (const eventDefinition of config.events) {
    if (eventDefinitions[eventDefinition.type]) {
      throw new DuplicateEventTypeError({ eventType: eventDefinition.type })
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
      throw new DuplicateSliceNameError({ sliceName: registration.name })
    }

    sliceNames.add(registration.name)

    switch (registration.kind) {
      case 'command':
        slicesByKind.commands[registration.name] = registration
        break
      case 'query':
        slicesByKind.queries[registration.name] = registration
        break
      case 'reaction':
        slicesByKind.reactions[registration.name] = registration
        break
    }
  }

  if (Object.keys(slicesByKind.commands).length === 0) {
    throw new EmptyCommandSetError()
  }

  for (const registration of config.slices) {
    for (const eventType of Object.keys(registration.apply ?? {})) {
      if (!eventDefinitions[eventType]) {
        throw new UnknownEventTypeError({ eventType })
      }
    }
  }

  const reactionExecs = new Map<string, ReactionExec>()
  const app: Record<string, unknown> = { runtime: { runReactions } }

  for (const command of Object.values(slicesByKind.commands)) {
    app[command.name] = (input: unknown) => runCommand(command, input)
  }

  for (const query of Object.values(slicesByKind.queries)) {
    app[query.name] = (input: unknown) => runQuery(query, input)
  }

  return app as SpecterApp<TConfig>

  function decodePersistedEvent(event: PersistedEvent) {
    const eventDefinition = eventDefinitions[event.type]
    if (!eventDefinition)
      throw new UnknownEventTypeError({ eventType: event.type })

    return { ...event, payload: eventDefinition.decode(event.payload) }
  }

  function decodeEventDraft(event: EventDraft) {
    const eventDefinition = eventDefinitions[event.type]
    if (!eventDefinition)
      throw new UnknownEventTypeError({ eventType: event.type })

    try {
      return { ...event, payload: eventDefinition.decode(event.payload) }
    } catch (error) {
      throw new InvalidEventDraftError({ eventType: event.type, error })
    }
  }

  async function catchUpSlice(
    slice: SliceRegistration,
    store: SliceStore,
    eventLog: EventLogAdapter = config.eventLog,
  ) {
    const eventTypes = Object.keys(slice.apply ?? {})

    if (!eventTypes.length) return { store, advanced: false } as const

    const lastAppliedOrder = await store.lastAppliedOrder()
    const unreadEvents = await eventLog.readAfter(lastAppliedOrder, eventTypes)
    const unappliedEvents = unreadEvents.map(decodePersistedEvent)

    if (!unappliedEvents.length) return { store, advanced: false } as const

    for (const event of unappliedEvents) {
      const apply = slice.apply[event.type]
      if (apply) await apply(event, store.write)
    }

    const lastEvent = unappliedEvents[unappliedEvents.length - 1]
    await store.setLastAppliedOrder(lastEvent.order)

    return { store, advanced: true } as const
  }

  async function runCommand(commandSlice: CommandSlice, input: unknown) {
    return config.eventLog.transaction((eventLog) =>
      commandSlice.store.transaction(commandSlice.name, async (store) => {
        const parsedCommand = await Schema.decodeUnknownPromise(
          commandSlice.schema,
        )(input).catch((error: ParseResult.ParseError) => {
          throw new InvalidCommandError({ error })
        })
        await catchUpSlice(commandSlice, store, eventLog)
        const events = await commandSlice.handle(parsedCommand, store.read)
        await eventLog.append(events.map(decodeEventDraft))
      }),
    )
  }

  async function runQuery(query: QuerySlice, input: unknown) {
    return query.store.transaction(query.name, async (store) => {
      const parsedInput = await Schema.decodeUnknownPromise(query.schema)(input)
      await catchUpSlice(query, store)

      return query.handle(parsedInput, store.read)
    })
  }

  function dispatch(c: CommandEnvelope) {
    const command = slicesByKind.commands[c.type]
    if (!command)
      return Promise.reject(new UnknownCommandError({ commandName: c.type }))

    return runCommand(command, c.payload)
  }

  async function getReactionExec(reaction: ReactionSlice<string, unknown>) {
    const cachedExec = reactionExecs.get(reaction.name)
    if (cachedExec) return cachedExec

    const exec = await reaction.plugin(dispatch)
    reactionExecs.set(reaction.name, exec)
    return exec
  }

  async function runReactions() {
    const reactionEffects = await Promise.all(
      Object.values(slicesByKind.reactions).map(async (reaction) => {
        try {
          const prepared = await reaction.store.transaction(
            reaction.name,
            async (store) => {
              const { advanced } = await catchUpSlice(reaction, store)
              if (!advanced) return undefined
              const effect = await reaction.handle(store.read)
              if (!effect) return undefined
              const exec = await getReactionExec(reaction)

              return { reaction, exec, effect } satisfies PreparedReactionEffect
            },
          )

          return {
            _tag: 'Prepared',
            prepared,
          } satisfies ReactionPreparationResult
        } catch (cause) {
          return {
            _tag: 'Failed',
            reactionName: reaction.name,
            cause,
          } satisfies ReactionPreparationResult
        }
      }),
    )
    const preparationFailures = reactionEffects.flatMap((result) =>
      result._tag === 'Failed'
        ? [{ reactionName: result.reactionName, cause: result.cause }]
        : [],
    )
    const results = await Promise.all(
      reactionEffects
        .flatMap((item) =>
          item._tag === 'Prepared' && item.prepared !== undefined
            ? [item.prepared]
            : [],
        )
        .map(async ({ reaction, exec, effect }) => {
          try {
            await exec(effect)
            return { failed: false as const, reactionName: reaction.name }
          } catch (cause) {
            return { failed: true as const, reactionName: reaction.name, cause }
          }
        }),
    )
    const failures = [
      ...preparationFailures,
      ...results.flatMap((result) =>
        result.failed
          ? [{ reactionName: result.reactionName, cause: result.cause }]
          : [],
      ),
    ]

    if (failures.length) throw new ReactionRunError({ failures })

    return results.length > 0
  }
}
