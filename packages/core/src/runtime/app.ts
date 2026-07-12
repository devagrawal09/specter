import type {
  EventLogAdapter,
  ReactionScheduler,
  SliceStore,
} from '../adapters'
import {
  assertConforms,
  commandScenarioEventTypes,
  decodeOptionalSchema,
  type ApplyEventDefinition,
  type ApplyRegistration,
  type CommandInputOf,
  type EventDraft,
  type QueryInputOf,
  type QueryOutputOf,
  valuesEqual,
} from '../definition'
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
  readonly events: readonly ApplyEventDefinition[]
  readonly eventLog: EventLogAdapter
  readonly schedule: ReactionScheduler
  readonly slices: readonly SliceRegistration[]
}

type CommandMethods<TSlices extends readonly SliceRegistration[]> = {
  [TSlice in Extract<TSlices[number], { kind: 'command' }> as TSlice['name']]: (
    input: CommandInputOf<TSlice>,
  ) => Promise<void>
}

type QueryMethods<TSlices extends readonly SliceRegistration[]> = {
  [TSlice in Extract<TSlices[number], { kind: 'query' }> as TSlice['name']]: (
    input: QueryInputOf<TSlice>,
  ) => Promise<QueryOutputOf<TSlice>>
}

export type QuerySubscriptionOptions = {
  readonly signal?: AbortSignal
}

type QuerySubscribeMethods<TSlices extends readonly SliceRegistration[]> = {
  [TSlice in Extract<TSlices[number], { kind: 'query' }> as TSlice['name']]: (
    input: QueryInputOf<TSlice>,
    options?: QuerySubscriptionOptions,
  ) => AsyncIterable<QueryOutputOf<TSlice>>
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
): Promise<SpecterApp<TConfig>> {
  return createValidatedSpecterApp(config)
}

async function createValidatedSpecterApp<
  const TConfig extends SpecterAppConfig,
>(config: TConfig): Promise<SpecterApp<TConfig>> {
  await assertConforms(config)

  const eventDefinitions: Record<string, ApplyEventDefinition> = {}

  for (const eventDefinition of config.events) {
    eventDefinitions[eventDefinition.type] = eventDefinition
  }

  const slicesByKind: {
    commands: Record<string, CommandSlice>
    queries: Record<string, QuerySlice>
    reactions: Record<string, ReactionSlice<string, unknown>>
  } = { commands: {}, queries: {}, reactions: {} }

  for (const registration of config.slices) {
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

  const applyBySlice = new Map<
    SliceRegistration,
    ReadonlyMap<string, ApplyRegistration>
  >()
  for (const registration of config.slices) {
    applyBySlice.set(
      registration,
      new Map(
        registration.apply.map((apply) => [apply.event.type, apply] as const),
      ),
    )
  }

  const allowedCommandEvents = new Map<CommandSlice, ReadonlySet<string>>()
  for (const command of Object.values(slicesByKind.commands)) {
    allowedCommandEvents.set(command, commandScenarioEventTypes(command))
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
    if (!valuesEqual(payload, event.payload)) {
      throw new Error(
        `Event schema transformed payload for "${event.type}". Event payload validation must preserve data one-to-one.`,
      )
    }

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
    const handlers = applyBySlice.get(slice)
    const eventTypes = [...(handlers?.keys() ?? [])]

    if (!eventTypes.length) return { store, advanced: false } as const

    const lastAppliedOrder = await store.lastAppliedOrder()
    const unreadEvents = await eventLog.query(lastAppliedOrder, eventTypes)
    const unappliedEvents = await Promise.all(
      unreadEvents.map(async (event) => {
        const eventDefinition = eventDefinitions[event.type]
        if (!eventDefinition)
          throw new Error(`Unknown event type: ${event.type}`)

        const payload = await eventDefinition.decode(event.payload)
        if (!valuesEqual(payload, event.payload)) {
          throw new Error(
            `Event schema transformed persisted payload for "${event.type}". Event payload validation must preserve data one-to-one.`,
          )
        }

        return { ...event, payload }
      }),
    )

    if (!unappliedEvents.length) {
      return { store, advanced: false } as const
    }

    for (const event of unappliedEvents) {
      const apply = handlers?.get(event.type)
      if (apply) await apply.handle(event, store.write)
    }

    const lastEvent = unappliedEvents[unappliedEvents.length - 1]
    await store.setLastAppliedOrder(lastEvent.order)

    return { store, advanced: true } as const
  }

  function runCommand(commandSlice: CommandSlice, input: unknown) {
    return commandSlice.store.transaction(commandSlice.name, (store) =>
      config.eventLog.transaction(async (eventLog) => {
        const parsedCommand = await decodeOptionalSchema(
          commandSlice.inputSchema,
          input,
        )

        await catchUpSlice(commandSlice, store, eventLog)

        const events = await commandSlice.handle(parsedCommand, store.read)
        if (events.length === 0) {
          throw new Error(`Command emitted no events: ${commandSlice.name}`)
        }

        const allowedEventTypes = allowedCommandEvents.get(commandSlice)
        for (const [index, event] of events.entries()) {
          if (!allowedEventTypes?.has(event.type)) {
            throw new Error(
              `Command "${commandSlice.name}" emitted unauthorized Event "${event.type}" at index ${index}. Add that Event type to an accepted scenario outcome before the command may emit it.`,
            )
          }
        }

        const decodedEvents = await Promise.all(events.map(decodeEventDraft))

        await eventLog.append(decodedEvents)
      }),
    )
  }

  function runQuery(query: QuerySlice, input: unknown) {
    return query.store.transaction(query.name, async (store) => {
      const parsedInput = await decodeOptionalSchema(query.inputSchema, input)

      await catchUpSlice(query, store)

      const result = await query.handle(parsedInput, store.read)

      return decodeOptionalSchema(query.outputSchema, result)
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

            const result = await reaction.handle(store.read)

            if (result === undefined) return undefined

            const effect = await decodeOptionalSchema(
              reaction.outputSchema,
              result,
            )

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
      state.abortSignal?.removeEventListener('abort', state.abortListener)

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
          options.signal?.addEventListener('abort', close, { once: true })
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
          const value = await query.store.transaction(
            query.name,
            async (store) => {
              const parsedInput = await decodeOptionalSchema(
                query.inputSchema,
                subscription.input,
              )
              const { advanced } = await catchUpSlice(query, store)

              if (!advanced) return undefined

              const result = await query.handle(parsedInput, store.read)

              return decodeOptionalSchema(query.outputSchema, result)
            },
          )

          if (value !== undefined) enqueueSubscriptionValue(subscription, value)
        } catch (cause) {
          enqueueSubscriptionError(subscription, cause)
        }
      }),
    )
  }
}
