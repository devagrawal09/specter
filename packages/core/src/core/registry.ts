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

export type ReactionRunFailureDetail = {
  readonly sliceName: string
  readonly cause: unknown
}

export class ReactionRunFailure extends AggregateError {
  readonly failures: readonly ReactionRunFailureDetail[]

  constructor(failures: readonly ReactionRunFailureDetail[]) {
    super(
      failures.map(({ cause }) => cause),
      reactionRunFailureMessage(failures),
    )
    this.name = 'ReactionRunFailure'
    this.failures = failures
  }
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

  async function getReactionExec(reaction: ReactionSlice<string, unknown>) {
    const cachedExec = reactionExecs.get(reaction.name)
    if (cachedExec) return cachedExec

    const exec = await reaction.plugin(async (c: CommandEnvelope) => {
      const command = slicesByKind.commands[c.type]
      if (!command) throw new Error(`Unknown command: ${c.type}`)

      await runCommand(command, c.payload)
      reactionDrainRequested = true
    })

    reactionExecs.set(reaction.name, exec)
    return exec
  }

  let reactionDrainRequested = false
  let activeReactionDrain: Promise<void> | undefined
  const app: Record<string, unknown> = {}

  for (const command of Object.values(slicesByKind.commands)) {
    app[command.name] = async (input: unknown) => {
      await runCommand(command, input)
      await requestReactionDrain()
    }
  }

  for (const query of Object.values(slicesByKind.queries)) {
    app[query.name] = (input: unknown) => runQuery(query, input)
  }

  return app as SpecterApp<TConfig>

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
      unreadEvents.map(async (event) => {
        const eventDefinition = eventDefinitions[event.type]
        if (!eventDefinition)
          throw new Error(`Unknown event type: ${event.type}`)

        const payload = await eventDefinition.decode(event.payload)

        return { ...event, payload }
      }),
    )

    if (!unappliedEvents.length) {
      return { store, advanced: false } as const
    }

    for (const event of unappliedEvents) {
      const apply = slice.apply[event.type]
      if (apply) await apply(event, store.write)
    }

    const lastEvent = unappliedEvents[unappliedEvents.length - 1]
    await store.setLastAppliedOrder(lastEvent.order)

    return { store, advanced: true } as const
  }

  function runCommand(commandSlice: CommandSlice, input: unknown) {
    return commandSlice.store.transaction(commandSlice.name, (store) =>
      config.eventLog.transaction(async (eventLog) => {
        const parsedCommand = await decodeSchema(commandSlice.schema, input)

        await catchUpSlice(commandSlice, store, eventLog)

        const events = await commandSlice.handle(parsedCommand, store.read)
        const decodedEvents = await Promise.all(events.map(decodeEventDraft))

        await eventLog.append(decodedEvents)
      }),
    )
  }

  function runQuery(query: QuerySlice, input: unknown) {
    return query.store.transaction(query.name, async (store) => {
      const parsedInput = await decodeSchema(query.schema, input)

      await catchUpSlice(query, store)

      return query.handle(parsedInput, store.read)
    })
  }

  function requestReactionDrain() {
    reactionDrainRequested = true

    if (!activeReactionDrain) {
      activeReactionDrain = loopReactionDrain().finally(() => {
        activeReactionDrain = undefined
      })
    }
    return activeReactionDrain
  }

  async function loopReactionDrain() {
    do {
      reactionDrainRequested = false

      const runnableEffects: PreparedReactionEffect[] = []
      const failures: ReactionRunFailureDetail[] = []

      for (const reaction of Object.values(slicesByKind.reactions)) {
        try {
          const preparedEffect = await reaction.store.transaction(
            reaction.name,
            async (store) => {
              const { advanced } = await catchUpSlice(reaction, store)

              if (!advanced) return undefined

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
        } catch (cause) {
          failures.push({ sliceName: reaction.name, cause })
        }
      }

      for (const { reaction, exec, effect } of runnableEffects) {
        try {
          await exec(effect)
        } catch (cause) {
          failures.push({ sliceName: reaction.name, cause })
        }
      }

      if (failures.length) {
        throw new ReactionRunFailure(failures)
      }
    } while (reactionDrainRequested)
  }
}

function reactionRunFailureMessage(
  failures: readonly ReactionRunFailureDetail[],
) {
  const sliceNames = [...new Set(failures.map(({ sliceName }) => sliceName))]

  return `Reaction run failed for: ${sliceNames.join(', ')}`
}
