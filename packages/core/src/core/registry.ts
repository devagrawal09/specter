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
  QueryMethods<TConfig['slices']>

type PreparedReactionEffect = {
  readonly reaction: ReactionSlice<string, unknown>
  readonly exec: ReactionExec
  readonly effect: unknown
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
      throw new Error(`Duplicate event type: ${eventDefinition.type}`)
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
      throw new Error(`Duplicate slice name: ${registration.name}`)
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
    throw new Error('At least one command slice must be registered')
  }

  for (const registration of config.slices) {
    for (const eventType of Object.keys(registration.apply ?? {})) {
      if (!eventDefinitions[eventType]) {
        throw new Error(`Unknown event type: ${eventType}`)
      }
    }
  }

  const reactionExecs = new Map<string, ReactionExec>()
  let isDrainingReactions = false
  let reactionDrainRequested = false
  let activeReactionDrain: Promise<void> | undefined
  const app: Record<string, unknown> = {}

  for (const command of Object.values(slicesByKind.commands)) {
    app[command.name] = (input: unknown) => runCommand(command, input)
  }

  for (const query of Object.values(slicesByKind.queries)) {
    app[query.name] = (input: unknown) => runQuery(query, input)
  }

  return app as SpecterApp<TConfig>

  async function decodePersistedEvent(event: PersistedEvent) {
    const eventDefinition = eventDefinitions[event.type]
    if (!eventDefinition) throw new Error(`Unknown event type: ${event.type}`)

    const payload = await eventDefinition.decode(event.payload)

    return {
      ...event,
      payload,
    }
  }

  async function decodeEventDraft(event: EventDraft) {
    const eventDefinition = eventDefinitions[event.type]
    if (!eventDefinition) throw new Error(`Unknown event type: ${event.type}`)

    const payload = await eventDefinition.decode(event.payload)

    return {
      ...event,
      payload,
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
    const unreadEvents = await eventLog.query(lastAppliedOrder, eventTypes)
    const unappliedEvents = await Promise.all(
      unreadEvents.map(decodePersistedEvent),
    )

    if (!unappliedEvents.length) {
      return { store, advanced: false } as const
    }

    await applyEvents(slice, store, unappliedEvents)

    const lastEvent = unappliedEvents[unappliedEvents.length - 1]
    await store.setLastAppliedOrder(lastEvent.order)

    return { store, advanced: true } as const
  }

  async function applyEvents(
    slice: SliceRegistration,
    store: SliceStore,
    events: readonly PersistedEvent[],
  ) {
    for (const event of events) {
      const apply = slice.apply[event.type]

      if (apply) await apply(event, store.write)
    }
  }

  async function runCommand(commandSlice: CommandSlice, input: unknown) {
    await runCommandOnly(commandSlice, input)
    await requestReactionDrain()
  }

  async function runCommandOnly(commandSlice: CommandSlice, input: unknown) {
    await commandSlice.store.transaction(commandSlice.name, async (store) => {
      await config.eventLog.transaction(async (eventLog) => {
        const parsedCommand = await decodeSchema(commandSlice.schema, input)

        await catchUpSlice(commandSlice, store, eventLog)

        const events = await commandSlice.handle(parsedCommand, store.read)
        const decodedEvents = await Promise.all(events.map(decodeEventDraft))

        await eventLog.append(decodedEvents)
      })
    })
  }

  function runQuery(query: QuerySlice, input: unknown) {
    return query.store.transaction(query.name, async (store) => {
      const parsedInput = await decodeSchema(query.schema, input)

      await catchUpSlice(query, store)

      return query.handle(parsedInput, store.read)
    })
  }

  async function dispatch(c: CommandEnvelope) {
    const command = slicesByKind.commands[c.type]
    if (!command) throw new Error(`Unknown command: ${c.type}`)

    await runCommandOnly(command, c.payload)
    reactionDrainRequested = true
  }

  async function getReactionExec(reaction: ReactionSlice<string, unknown>) {
    const cachedExec = reactionExecs.get(reaction.name)
    if (cachedExec) return cachedExec

    const exec = await reaction.plugin(dispatch)

    reactionExecs.set(reaction.name, exec)
    return exec
  }

  function requestReactionDrain() {
    reactionDrainRequested = true

    if (isDrainingReactions) return activeReactionDrain ?? Promise.resolve()

    activeReactionDrain = drainReactions()
    return activeReactionDrain
  }

  async function drainReactions() {
    isDrainingReactions = true

    try {
      await loopReactionDrain()
    } finally {
      isDrainingReactions = false
      activeReactionDrain = undefined
    }
  }

  async function loopReactionDrain() {
    do {
      reactionDrainRequested = false
    } while ((await runReactionPass()) || reactionDrainRequested)
  }

  async function runReactionPass() {
    const runnableEffects: PreparedReactionEffect[] = []
    let madeProgress = false

    for (const reaction of Object.values(slicesByKind.reactions)) {
      const preparedEffect = await reaction.store.transaction(
        reaction.name,
        async (store) => {
          const { advanced } = await catchUpSlice(reaction, store)

          if (!advanced) return undefined

          madeProgress = true

          const effect = await reaction.handle(store.read)

          if (effect === undefined) return undefined

          const exec = await getReactionExec(reaction)

          return {
            reaction,
            exec,
            effect,
          } satisfies PreparedReactionEffect
        },
      )

      if (preparedEffect) runnableEffects.push(preparedEffect)
    }

    for (const { exec, effect } of runnableEffects) {
      await exec(effect)
    }

    return madeProgress || runnableEffects.length > 0
  }
}
