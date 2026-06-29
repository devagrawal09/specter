import type { StandardSchemaV1 } from '@standard-schema/spec'

import type {
  EventLogAdapter,
  ReactionScheduler,
  SliceStore,
} from '../adapters'
import { decodeSchema, type EventDraft } from '../definition'
import type {
  CommandEnvelope,
  CommandSlice,
  QuerySlice,
  ReactionExec,
  ReactionSlice,
  SliceRegistration,
} from '../definition'
import { ReactionRunFailure, type ReactionRunFailureDetail } from './errors'

export type SpecterAppConfig = {
  readonly events: readonly {
    readonly type: string
    readonly decode: (payload: unknown) => Promise<unknown>
  }[]
  readonly eventLog: EventLogAdapter
  readonly schedule: ReactionScheduler
  readonly slices: readonly SliceRegistration[]
}

type CommandInput<TSlice> =
  TSlice extends CommandSlice<
    string,
    infer TSchema,
    infer _TWrite,
    infer _TRead
  >
    ? StandardSchemaV1.InferOutput<TSchema>
    : never

type QueryInput<TSlice> =
  TSlice extends QuerySlice<
    string,
    infer TSchema,
    infer _TResult,
    infer _TWrite,
    infer _TRead
  >
    ? StandardSchemaV1.InferOutput<TSchema>
    : never

type QueryOutput<TSlice> =
  TSlice extends QuerySlice<
    string,
    infer _TSchema,
    infer TResult,
    infer _TWrite,
    infer _TRead
  >
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

export type QuerySubscriptionOptions = {
  readonly signal?: AbortSignal
}

type QuerySubscribeMethods<TSlices extends readonly SliceRegistration[]> = {
  [TSlice in Extract<TSlices[number], { kind: 'query' }> as TSlice['name']]: (
    input: QueryInput<TSlice>,
    options?: QuerySubscriptionOptions,
  ) => AsyncIterable<QueryOutput<TSlice>>
}

export type SpecterApp<TConfig extends SpecterAppConfig> = CommandMethods<
  TConfig['slices']
> &
  QueryMethods<TConfig['slices']> & {
    readonly subscribe: QuerySubscribeMethods<TConfig['slices']>
  }

type PreparedReactionEffect = {
  readonly reaction: ReactionSlice<string, unknown>
  readonly exec: ReactionExec
  readonly effect: unknown
}

type PendingSubscriptionNext = {
  readonly resolve: (result: IteratorResult<unknown>) => void
  readonly reject: (cause: unknown) => void
}

type QuerySubscriptionState = {
  readonly queryName: string
  readonly input: unknown
  readonly abortSignal?: AbortSignal
  readonly abortListener: () => void
  closed: boolean
  hasBufferedValue: boolean
  bufferedValue: unknown
  pendingNext?: PendingSubscriptionNext
  pendingError?: unknown
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
      // The active drain owns idleness; reaction-emitted commands only request
      // another pass so they do not await themselves.
      requestReactions()
    })

    reactionExecs.set(reaction.name, exec)
    return exec
  }

  const requestReactions = config.schedule(runReactions)
  const subscriptions = new Set<QuerySubscriptionState>()
  const app: Record<string, unknown> = {}

  for (const command of Object.values(slicesByKind.commands)) {
    app[command.name] = async (input: unknown) => {
      await runCommand(command, input)
      const waitForReactionsIdle = requestReactions()
      await waitForReactionsIdle()
      await invalidateSubscriptions()
    }
  }

  for (const query of Object.values(slicesByKind.queries)) {
    app[query.name] = (input: unknown) => runQuery(query, input)
  }

  app.subscribe = {}
  for (const query of Object.values(slicesByKind.queries)) {
    ;(app.subscribe as Record<string, unknown>)[query.name] = (
      input: unknown,
      options?: QuerySubscriptionOptions,
    ) => subscribeQuery(query, input, options)
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
        if (events.length === 0) {
          throw new Error(`Command emitted no events: ${commandSlice.name}`)
        }

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

  async function runReactions() {
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
  }

  function subscribeQuery(
    query: QuerySlice,
    input: unknown,
    options: QuerySubscriptionOptions = {},
  ): AsyncIterable<unknown> {
    let state: QuerySubscriptionState | undefined

    function close() {
      if (!state || state.closed) return

      state.closed = true
      subscriptions.delete(state)
      state.abortSignal?.removeEventListener("abort", state.abortListener)

      if (state.pendingNext) {
        const pending = state.pendingNext
        state.pendingNext = undefined
        pending.resolve({ done: true, value: undefined })
      }
    }

    async function enqueueInitialValue(subscription: QuerySubscriptionState) {
      try {
        const value = await runQuery(query, input)
        enqueueSubscriptionValue(subscription, value)
      } catch (cause) {
        enqueueSubscriptionError(subscription, cause)
      }
    }

    return {
      [Symbol.asyncIterator]() {
        if (!state) {
          state = {
            queryName: query.name,
            input,
            abortSignal: options.signal,
            abortListener: close,
            closed: false,
            hasBufferedValue: false,
            bufferedValue: undefined,
          }

          subscriptions.add(state)
          options.signal?.addEventListener("abort", close, { once: true })
          void enqueueInitialValue(state)
        }

        return {
          next() {
            if (!state || state.closed) {
              return Promise.resolve({ done: true, value: undefined })
            }

            if (state.pendingError !== undefined) {
              const cause = state.pendingError
              state.pendingError = undefined
              return Promise.reject(cause)
            }

            if (state.hasBufferedValue) {
              const value = state.bufferedValue
              state.hasBufferedValue = false
              state.bufferedValue = undefined
              return Promise.resolve({ done: false, value })
            }

            return new Promise<IteratorResult<unknown>>((resolve, reject) => {
              if (!state || state.closed) {
                resolve({ done: true, value: undefined })
                return
              }

              state.pendingNext = { resolve, reject }
            })
          },
          return() {
            close()
            return Promise.resolve({ done: true, value: undefined })
          },
          throw(cause?: unknown) {
            close()
            return Promise.reject(cause)
          },
          [Symbol.asyncIterator]() {
            return this
          },
        } satisfies AsyncIterator<unknown> & AsyncIterable<unknown>
      },
    }
  }

  function enqueueSubscriptionValue(
    subscription: QuerySubscriptionState,
    value: unknown,
  ) {
    if (subscription.closed) return

    if (subscription.pendingNext) {
      const pending = subscription.pendingNext
      subscription.pendingNext = undefined
      pending.resolve({ done: false, value })
      return
    }

    subscription.bufferedValue = value
    subscription.hasBufferedValue = true
  }

  function enqueueSubscriptionError(
    subscription: QuerySubscriptionState,
    cause: unknown,
  ) {
    if (subscription.closed) return

    if (subscription.pendingNext) {
      const pending = subscription.pendingNext
      subscription.pendingNext = undefined
      pending.reject(cause)
      return
    }

    subscription.pendingError = cause
  }

  async function invalidateSubscriptions() {
    await Promise.all(
      [...subscriptions].map(async (subscription) => {
        if (subscription.closed) return

        const query = slicesByKind.queries[subscription.queryName]
        if (!query) return

        try {
          const value = await query.store.transaction(query.name, async (store) => {
            const parsedInput = await decodeSchema(query.schema, subscription.input)
            const { advanced } = await catchUpSlice(query, store)

            if (!advanced) return undefined

            return query.handle(parsedInput, store.read)
          })

          if (value !== undefined) enqueueSubscriptionValue(subscription, value)
        } catch (cause) {
          enqueueSubscriptionError(subscription, cause)
        }
      }),
    )
  }
}
