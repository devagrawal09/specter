import type { StandardSchemaV1 } from '@standard-schema/spec'

import type { EventLogAdapter, SliceStore } from '../adapters/contracts'
import type { EventDraft, PersistedEvent } from './event'
import { decodeSchema } from './schema'
import type {
  CommandEnvelope,
  CommandSlice,
  QuerySlice,
  ReactionExec,
  ReactionSlice,
  SliceRegistration,
} from './slice'
export { CommandRejectedError } from './errors'

export class EmptyCommandSetError extends Error {
  readonly _tag = 'EmptyCommandSetError'

  constructor() {
    super('At least one command slice must be registered')
    this.name = 'EmptyCommandSetError'
  }
}

export class InvalidCommandError extends Error {
  readonly _tag = 'InvalidCommandError'
  readonly error: readonly StandardSchemaV1.Issue[]

  constructor(input: { readonly error: readonly StandardSchemaV1.Issue[] }) {
    super('Invalid command input')
    this.name = 'InvalidCommandError'
    this.error = input.error
  }
}

export class InvalidEventDraftError extends Error {
  readonly _tag = 'InvalidEventDraftError'
  readonly eventType: string
  readonly error: unknown

  constructor(input: { readonly eventType: string; readonly error: unknown }) {
    super(`Invalid event draft: ${input.eventType}`)
    this.name = 'InvalidEventDraftError'
    this.eventType = input.eventType
    this.error = input.error
  }
}

export class InvalidQueryInputError extends Error {
  readonly _tag = 'InvalidQueryInputError'
  readonly queryName: string
  readonly error: readonly StandardSchemaV1.Issue[]

  constructor(input: {
    readonly queryName: string
    readonly error: readonly StandardSchemaV1.Issue[]
  }) {
    super(`Invalid query input: ${input.queryName}`)
    this.name = 'InvalidQueryInputError'
    this.queryName = input.queryName
    this.error = input.error
  }
}

export class UnknownCommandError extends Error {
  readonly _tag = 'UnknownCommandError'
  readonly commandName: string

  constructor(input: { readonly commandName: string }) {
    super(`Unknown command: ${input.commandName}`)
    this.name = 'UnknownCommandError'
    this.commandName = input.commandName
  }
}

export class UnknownQueryError extends Error {
  readonly _tag = 'UnknownQueryError'
  readonly queryName: string

  constructor(input: { readonly queryName: string }) {
    super(`Unknown query: ${input.queryName}`)
    this.name = 'UnknownQueryError'
    this.queryName = input.queryName
  }
}

export class DuplicateSliceNameError extends Error {
  readonly _tag = 'DuplicateSliceNameError'
  readonly sliceName: string

  constructor(input: { readonly sliceName: string }) {
    super(`Duplicate slice name: ${input.sliceName}`)
    this.name = 'DuplicateSliceNameError'
    this.sliceName = input.sliceName
  }
}

export class DuplicateEventTypeError extends Error {
  readonly _tag = 'DuplicateEventTypeError'
  readonly eventType: string

  constructor(input: { readonly eventType: string }) {
    super(`Duplicate event type: ${input.eventType}`)
    this.name = 'DuplicateEventTypeError'
    this.eventType = input.eventType
  }
}

export class UnknownEventTypeError extends Error {
  readonly _tag = 'UnknownEventTypeError'
  readonly eventType: string

  constructor(input: { readonly eventType: string }) {
    super(`Unknown event type: ${input.eventType}`)
    this.name = 'UnknownEventTypeError'
    this.eventType = input.eventType
  }
}

export class ReactionRunError extends Error {
  readonly _tag = 'ReactionRunError'
  readonly failures: readonly {
    readonly reactionName: string
    readonly cause: unknown
  }[]

  constructor(input: {
    readonly failures: readonly {
      readonly reactionName: string
      readonly cause: unknown
    }[]
  }) {
    super('One or more reactions failed')
    this.name = 'ReactionRunError'
    this.failures = input.failures
  }
}

export type SpecterAppConfig = {
  readonly events: readonly {
    readonly type: string
    readonly decode: (payload: unknown) => Promise<unknown>
  }[]
  readonly eventLog: EventLogAdapter
  readonly slices: readonly SliceRegistration[]
}

type CommandInput<TSlice> =
  TSlice extends CommandSlice<string, infer TSchema>
    ? StandardSchemaV1.InferOutput<TSchema>
    : never

type QueryInput<TSlice> =
  TSlice extends QuerySlice<string, infer TSchema>
    ? StandardSchemaV1.InferOutput<TSchema>
    : never

type QueryOutput<TSlice> =
  TSlice extends QuerySlice<string, infer _TSchema, infer TResult>
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
    {
      readonly type: string
      readonly decode: (payload: unknown) => Promise<unknown>
    }
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

  async function decodePersistedEvent(event: PersistedEvent) {
    const eventDefinition = eventDefinitions[event.type]
    if (!eventDefinition)
      throw new UnknownEventTypeError({ eventType: event.type })

    return { ...event, payload: await eventDefinition.decode(event.payload) }
  }

  async function decodeEventDraft(event: EventDraft) {
    const eventDefinition = eventDefinitions[event.type]
    if (!eventDefinition)
      throw new UnknownEventTypeError({ eventType: event.type })

    try {
      return { ...event, payload: await eventDefinition.decode(event.payload) }
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
    const unappliedEvents = await Promise.all(
      unreadEvents.map(decodePersistedEvent),
    )

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
        const parsedCommand = await decodeSchema(
          commandSlice.schema,
          input,
        ).catch((error: readonly StandardSchemaV1.Issue[]) => {
          throw new InvalidCommandError({ error })
        })
        await catchUpSlice(commandSlice, store, eventLog)
        const events = await commandSlice.handle(parsedCommand, store.read)
        await eventLog.append(await Promise.all(events.map(decodeEventDraft)))
      }),
    )
  }

  async function runQuery(query: QuerySlice, input: unknown) {
    return query.store.transaction(query.name, async (store) => {
      const parsedInput = await decodeSchema(query.schema, input).catch(
        (error: readonly StandardSchemaV1.Issue[]) => {
          throw new InvalidQueryInputError({ queryName: query.name, error })
        },
      )
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
