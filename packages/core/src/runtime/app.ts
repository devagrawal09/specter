import type {
  EventLogAdapter,
  EventLogAppendResult,
  EventLogTransaction,
  ReactionDeliveryContext,
  ReactionScheduler,
  SliceStore,
} from '../adapters'
import {
  assertConforms,
  commandScenarioEventTypes,
  decodeOptionalSchema,
  type ApplyEventDefinition,
  type ApplyRegistration,
  type CommandEnvelope,
  type CommandDispatchOptions,
  type CommandSlice,
  type EventDraft,
  type PersistedEvent,
  type QuerySlice,
  type ReactionExec,
  type ReactionSlice,
  type SliceRegistration,
  valuesEqual,
} from '../definition'
import {
  ReactionRunFailure,
  type ReactionRunFailureDetail,
  SpecterCommandRejectedError,
  SpecterError,
  SpecterEventLogOrderError,
  SpecterIdempotencyConflictError,
  SpecterInfrastructureError,
  SpecterInvalidCommandOptionsError,
  SpecterInvalidInputError,
  SpecterInvalidOutputError,
  SpecterUnknownCommandError,
  SpecterUnknownEventError,
  SpecterUnknownQueryError,
  SpecterVersionConflictError,
} from './errors'

export type SpecterObservation =
  | {
      readonly type: 'slice-caught-up'
      readonly sliceName: string
      readonly fromOrder: number
      readonly toOrder: number
      readonly eventCount: number
    }
  | {
      readonly type: 'command-committed'
      readonly commandType: string
      readonly version: number
      readonly eventCount: number
      readonly duplicate: boolean
    }
  | {
      readonly type: 'subscriptions-invalidated'
      readonly queryName: string
      readonly subscriberCount: number
    }
  | {
      readonly type: 'reaction-run-started'
      readonly reactionName: string
    }
  | {
      readonly type: 'reaction-run-completed'
      readonly reactionName: string
      readonly durationMs: number
    }
  | {
      readonly type: 'reaction-run-failed'
      readonly reactionName: string
      readonly durationMs: number
      readonly cause: unknown
    }
  | {
      readonly type: 'reaction-pass-completed'
      readonly failureCount: number
    }

export type SpecterObserver = (observation: SpecterObservation) => void

export type SpecterAppConfig = {
  readonly events: readonly ApplyEventDefinition[]
  readonly eventLog: EventLogAdapter
  readonly schedule: ReactionScheduler
  readonly slices: readonly SliceRegistration[]
  readonly observe?: SpecterObserver
  /** Releases app-owned adapter resources. Called once by `app.close()`. */
  readonly dispose?: () => Promise<void>
}

type CommandRegistration<TConfig extends SpecterAppConfig> = Extract<
  TConfig['slices'][number],
  { kind: 'command' }
>

type QueryRegistration<TConfig extends SpecterAppConfig> = Extract<
  TConfig['slices'][number],
  { kind: 'query' }
>

type CommandEnvelopeFor<TCommand> =
  TCommand extends CommandSlice<
    infer TName,
    infer TInput,
    infer _TCommand,
    infer _TWriteState,
    infer _TReadState,
    infer _TScenarios
  >
    ? {
        readonly type: TName
        readonly payload: TInput
      }
    : never

type QueryEnvelopeFor<TQuery> =
  TQuery extends QuerySlice<
    infer TName,
    infer TInput,
    infer _TQuery,
    infer _TResult,
    infer _TOutput,
    infer _TWriteState,
    infer _TReadState,
    infer _TScenarios
  >
    ? {
        readonly type: TName
        readonly payload: TInput
      }
    : never

export type SpecterCommandEnvelope<TConfig extends SpecterAppConfig> =
  CommandEnvelopeFor<CommandRegistration<TConfig>>

export type SpecterQueryEnvelope<TConfig extends SpecterAppConfig> =
  QueryEnvelopeFor<QueryRegistration<TConfig>>

export type SpecterCommandType<TConfig extends SpecterAppConfig> =
  SpecterCommandEnvelope<TConfig>['type']

export type SpecterQueryType<TConfig extends SpecterAppConfig> =
  SpecterQueryEnvelope<TConfig>['type']

export type SpecterQueryResult<
  TConfig extends SpecterAppConfig,
  TType extends SpecterQueryType<TConfig>,
> =
  Extract<QueryRegistration<TConfig>, { name: TType }> extends QuerySlice<
    infer _TName,
    infer _TInput,
    infer _TQuery,
    infer _TResult,
    infer TOutput,
    infer _TWriteState,
    infer _TReadState,
    infer _TScenarios
  >
    ? TOutput
    : never

export type CommandExecutionOptions = CommandDispatchOptions

export type CommandExecution = {
  readonly events: readonly PersistedEvent[]
  readonly version: number
  readonly duplicate: boolean
  /** Settles after every independently runnable Reaction has completed. */
  readonly reactions: Promise<void>
}

export type QuerySubscriptionOptions = {
  readonly signal?: AbortSignal
}

declare const specterAppConfig: unique symbol

export type SpecterApp<TConfig extends SpecterAppConfig> = {
  readonly [specterAppConfig]?: TConfig
  command: <const TCommand extends SpecterCommandEnvelope<TConfig>>(
    command: TCommand,
    options?: CommandExecutionOptions,
  ) => Promise<CommandExecution>
  query: <const TQuery extends SpecterQueryEnvelope<TConfig>>(
    query: TQuery,
  ) => Promise<SpecterQueryResult<TConfig, TQuery['type']>>
  subscribe: <const TQuery extends SpecterQueryEnvelope<TConfig>>(
    query: TQuery,
    options?: QuerySubscriptionOptions,
  ) => AsyncIterable<SpecterQueryResult<TConfig, TQuery['type']>>
  close: () => Promise<void>
}

export type SpecterAppConfigOf<TApp> =
  TApp extends SpecterApp<infer TConfig> ? TConfig : never

type PendingSubscriptionNext = {
  readonly resolve: (result: IteratorResult<unknown>) => void
  readonly reject: (cause: unknown) => void
}

type QuerySubscriptionState = {
  readonly query: QuerySlice
  readonly input: unknown
  readonly pendingNext: PendingSubscriptionNext[]
  readonly abortSignal?: AbortSignal
  readonly abortListener: () => void
  readonly close: () => void
  closed: boolean
  hasBufferedValue: boolean
  bufferedValue: unknown
  hasPendingError: boolean
  pendingError: unknown
}

type CommandCommit = EventLogAppendResult

export function createSpecterApp<const TConfig extends SpecterAppConfig>(
  config: TConfig,
): Promise<SpecterApp<TConfig>> {
  return createValidatedSpecterApp(config)
}

async function createValidatedSpecterApp<
  const TConfig extends SpecterAppConfig,
>(config: TConfig): Promise<SpecterApp<TConfig>> {
  await assertConforms(config)

  const eventDefinitions = new Map<string, ApplyEventDefinition>()
  for (const eventDefinition of config.events) {
    eventDefinitions.set(eventDefinition.type, eventDefinition)
  }

  const commands = new Map<string, CommandSlice>()
  const queries = new Map<string, QuerySlice>()
  const reactions = new Map<string, ReactionSlice<string, unknown>>()
  for (const registration of config.slices) {
    switch (registration.kind) {
      case 'command':
        commands.set(registration.name, registration)
        break
      case 'query':
        queries.set(registration.name, registration)
        break
      case 'reaction':
        reactions.set(registration.name, registration)
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
  for (const command of commands.values()) {
    allowedCommandEvents.set(command, commandScenarioEventTypes(command))
  }

  const reactionExecs = new Map<string, ReactionExec>()
  const subscriptions = new Set<QuerySubscriptionState>()
  const pendingInvalidationEventTypes = new Set<string>()
  let closePromise: Promise<void> | undefined

  const requestReactions = config.schedule(runReactions)

  const app = Object.freeze({
    command: dispatchCommand,
    query: dispatchQuery,
    subscribe: dispatchSubscription,
    close: closeApp,
  }) as SpecterApp<TConfig>

  if (reactions.size > 0) {
    try {
      await requestReactions()()
    } catch (cause) {
      if (isPublicSpecterError(cause)) throw cause
      throw new SpecterInfrastructureError(
        'The startup Reaction recovery pass failed.',
        cause,
      )
    }
  }

  return app

  function observe(observation: SpecterObservation) {
    try {
      config.observe?.(observation)
    } catch {
      // Observability is deliberately best-effort and cannot change domain
      // semantics or turn a successful commit into a failed command.
    }
  }

  function closeApp() {
    if (!closePromise) {
      closePromise = (async () => {
        for (const subscription of [...subscriptions]) subscription.close()
        await config.dispose?.()
      })()
    }
    return closePromise
  }

  async function getReactionExec(reaction: ReactionSlice<string, unknown>) {
    const cachedExec = reactionExecs.get(reaction.name)
    if (cachedExec) return cachedExec

    const exec = await reaction.plugin(
      async (command: CommandEnvelope, options?: CommandDispatchOptions) => {
        await dispatchReactionCommand(command, options)
      },
    )

    reactionExecs.set(reaction.name, exec)
    return exec
  }

  async function dispatchReactionCommand(
    envelope: CommandEnvelope,
    options: CommandDispatchOptions = {},
  ) {
    const command = commands.get(envelope.type)
    if (!command) throw new SpecterUnknownCommandError(envelope.type)

    validateCommandOptions(options)
    const parsedCommand = await decodeCommandInput(command, envelope.payload)
    const fingerprint = options.idempotencyKey
      ? await fingerprintCommand(command.name, parsedCommand)
      : undefined
    const commit = await runCommand(command, parsedCommand, {
      ...options,
      fingerprint,
    })
    observe({
      type: 'command-committed',
      commandType: command.name,
      version: commit.version,
      eventCount: commit.events.length,
      duplicate: commit.duplicate,
    })
    if (commit.duplicate) return

    for (const event of commit.events) {
      pendingInvalidationEventTypes.add(event.type)
    }

    try {
      // The active Reaction drain owns completion. Request another pass without
      // awaiting its waiter, which would make the drain wait on itself.
      requestReactions()
    } catch (cause) {
      throw new SpecterInfrastructureError(
        'The Reaction scheduler failed after a Reaction Command was committed.',
        cause,
      )
    }
  }

  async function dispatchCommand(
    envelope: SpecterCommandEnvelope<TConfig>,
    options: CommandExecutionOptions = {},
  ): Promise<CommandExecution> {
    const command = commands.get(envelope.type)
    if (!command) throw new SpecterUnknownCommandError(envelope.type)

    validateCommandOptions(options)
    const parsedCommand = await decodeCommandInput(command, envelope.payload)
    const fingerprint = options.idempotencyKey
      ? await fingerprintCommand(command.name, parsedCommand)
      : undefined
    const commit = await runCommand(command, parsedCommand, {
      ...options,
      fingerprint,
    })

    observe({
      type: 'command-committed',
      commandType: command.name,
      version: commit.version,
      eventCount: commit.events.length,
      duplicate: commit.duplicate,
    })

    if (commit.duplicate) {
      return {
        events: commit.events,
        version: commit.version,
        duplicate: true,
        reactions: requestReactionCompletion(
          Promise.resolve(),
          'The Reaction scheduler failed while catching up a duplicate Command.',
        ),
      }
    }

    for (const event of commit.events) {
      pendingInvalidationEventTypes.add(event.type)
    }
    const commandInvalidation = invalidateSubscriptions()

    const reactionsPromise = requestReactionCompletion(
      commandInvalidation,
      'The Reaction scheduler failed after the Command was committed.',
    )

    return {
      events: commit.events,
      version: commit.version,
      duplicate: false,
      reactions: reactionsPromise,
    }
  }

  async function dispatchQuery(
    envelope: SpecterQueryEnvelope<TConfig>,
  ): Promise<unknown> {
    const query = queries.get(envelope.type)
    if (!query) throw new SpecterUnknownQueryError(envelope.type)

    return runQuery(query, envelope.payload)
  }

  function dispatchSubscription(
    envelope: SpecterQueryEnvelope<TConfig>,
    options: QuerySubscriptionOptions = {},
  ): AsyncIterable<unknown> {
    const query = queries.get(envelope.type)
    if (!query) throw new SpecterUnknownQueryError(envelope.type)

    return subscribeQuery(query, envelope.payload, options)
  }

  async function settleReactionsAndSubscriptions(
    reactionRun: Promise<void>,
    commandInvalidation: Promise<void>,
  ) {
    const reactionOutcome = reactionRun.then(
      () => ({ succeeded: true as const }),
      (cause: unknown) => ({ succeeded: false as const, cause }),
    )
    await commandInvalidation
    const outcome = await reactionOutcome
    await invalidateSubscriptions()
    if (!outcome.succeeded) throw outcome.cause
  }

  function requestReactionCompletion(
    commandInvalidation: Promise<void>,
    schedulerFailureMessage: string,
  ) {
    try {
      const waitForReactionsIdle = requestReactions()
      return settleReactionsAndSubscriptions(
        waitForReactionsIdle(),
        commandInvalidation,
      )
    } catch (cause) {
      return settleReactionsAndSubscriptions(
        Promise.reject(
          new SpecterInfrastructureError(schedulerFailureMessage, cause),
        ),
        commandInvalidation,
      )
    }
  }

  async function decodeEventDraft(event: EventDraft) {
    const eventDefinition = eventDefinitions.get(event.type)
    if (!eventDefinition) throw new SpecterUnknownEventError(event.type)

    let payload: unknown
    try {
      payload = await eventDefinition.decode(event.payload)
    } catch (cause) {
      throw new SpecterInfrastructureError(
        `Event schema rejected payload for "${event.type}".`,
        cause,
      )
    }

    if (!valuesEqual(payload, event.payload)) {
      throw new SpecterInfrastructureError(
        `Event schema transformed payload for "${event.type}". Event payload validation must preserve data one-to-one.`,
        undefined,
      )
    }

    return { ...event, payload }
  }

  async function catchUpSlice(
    slice: SliceRegistration,
    store: SliceStore,
    eventLog: EventLogTransaction = config.eventLog,
    options: { readonly advanceCursor?: boolean } = {},
  ) {
    const handlers = applyBySlice.get(slice)
    const eventTypes = [...(handlers?.keys() ?? [])]

    if (!eventTypes.length) {
      const order = await store.lastAppliedOrder()
      return {
        store,
        advanced: false,
        fromOrder: order,
        toOrder: order,
        eventCount: 0,
      } as const
    }

    const lastAppliedOrder = await store.lastAppliedOrder()
    const unreadEvents = await eventLog.query(lastAppliedOrder, eventTypes)
    assertEventLogOrder(lastAppliedOrder, unreadEvents)

    const unappliedEvents = await Promise.all(
      unreadEvents.map(async (event) => {
        const eventDefinition = eventDefinitions.get(event.type)
        if (!eventDefinition) throw new SpecterUnknownEventError(event.type)

        let payload: unknown
        try {
          payload = await eventDefinition.decode(event.payload)
        } catch (cause) {
          throw new SpecterInfrastructureError(
            `Event schema rejected persisted payload for "${event.type}".`,
            cause,
          )
        }
        if (!valuesEqual(payload, event.payload)) {
          throw new SpecterInfrastructureError(
            `Event schema transformed persisted payload for "${event.type}". Event payload validation must preserve data one-to-one.`,
            undefined,
          )
        }

        return { ...event, payload }
      }),
    )

    if (!unappliedEvents.length) {
      return {
        store,
        advanced: false,
        fromOrder: lastAppliedOrder,
        toOrder: lastAppliedOrder,
        eventCount: 0,
      } as const
    }

    for (const event of unappliedEvents) {
      const apply = handlers?.get(event.type)
      if (apply) await apply.handle(event, store.write)
    }

    const lastEvent = unappliedEvents[unappliedEvents.length - 1]
    if (options.advanceCursor !== false) {
      await store.setLastAppliedOrder(lastEvent.order)
      observe({
        type: 'slice-caught-up',
        sliceName: slice.name,
        fromOrder: lastAppliedOrder,
        toOrder: lastEvent.order,
        eventCount: unappliedEvents.length,
      })
    }

    return {
      store,
      advanced: true,
      fromOrder: lastAppliedOrder,
      toOrder: lastEvent.order,
      eventCount: unappliedEvents.length,
    } as const
  }

  async function runCommand(
    commandSlice: CommandSlice,
    parsedCommand: unknown,
    options: CommandExecutionOptions & { readonly fingerprint?: string },
  ): Promise<CommandCommit> {
    try {
      return await config.eventLog.transaction(async (eventLog) => {
        if (options.idempotencyKey) {
          const previous = await eventLog.findCommit(options.idempotencyKey)
          if (previous) {
            if (
              !previous.fingerprint ||
              previous.fingerprint !== options.fingerprint
            ) {
              throw new SpecterIdempotencyConflictError(options.idempotencyKey)
            }

            return { ...previous, duplicate: true }
          }
        }

        const version = await eventLog.currentVersion()
        if (
          options.expectedVersion !== undefined &&
          options.expectedVersion !== version
        ) {
          throw new SpecterVersionConflictError(
            options.expectedVersion,
            version,
          )
        }

        const store = await commandSlice.store.get(commandSlice.name)
        await catchUpSlice(commandSlice, store, eventLog)

        let events: readonly EventDraft[]
        try {
          events = await commandSlice.handle(parsedCommand, store.read)
        } catch (cause) {
          if (cause instanceof SpecterCommandRejectedError) throw cause
          throw new SpecterCommandRejectedError(commandSlice.name, cause)
        }

        if (events.length === 0) {
          throw new SpecterCommandRejectedError(
            commandSlice.name,
            new Error('Command emitted no Events.'),
          )
        }

        const allowedEventTypes = allowedCommandEvents.get(commandSlice)
        for (const [index, event] of events.entries()) {
          if (!allowedEventTypes?.has(event.type)) {
            throw new SpecterInfrastructureError(
              `Command "${commandSlice.name}" emitted unauthorized Event "${event.type}" at index ${index}. Add that Event type to an accepted scenario outcome before the Command may emit it.`,
              undefined,
            )
          }
        }

        const decodedEvents = await Promise.all(events.map(decodeEventDraft))
        const committed = await eventLog.append(decodedEvents, {
          // Compare-and-swap against the exact Event Log version used for the
          // decision, even when the caller did not supply expectedVersion.
          expectedVersion: version,
          idempotencyKey: options.idempotencyKey,
          fingerprint: options.fingerprint,
        })

        return committed
      })
    } catch (cause) {
      if (isPublicSpecterError(cause)) throw cause
      throw new SpecterInfrastructureError(
        `Command "${commandSlice.name}" failed in its Event Log transaction.`,
        cause,
      )
    }
  }

  async function runQuery(query: QuerySlice, input: unknown) {
    try {
      return await query.store.transaction(query.name, async (store) => {
        let parsedInput: unknown
        try {
          parsedInput = await decodeOptionalSchema(query.inputSchema, input)
        } catch (cause) {
          throw new SpecterInvalidInputError('query', query.name, cause)
        }

        await catchUpSlice(query, store)

        const result = await query.handle(parsedInput, store.read)

        try {
          return await decodeOptionalSchema(query.outputSchema, result)
        } catch (cause) {
          throw new SpecterInvalidOutputError('query', query.name, cause)
        }
      })
    } catch (cause) {
      if (isPublicSpecterError(cause)) throw cause
      throw new SpecterInfrastructureError(
        `Query "${query.name}" failed while reading its Slice State.`,
        cause,
      )
    }
  }

  async function runReactions(passContext: ReactionDeliveryContext) {
    const results = await Promise.all(
      [...reactions.values()].map(async (reaction) => {
        const startedAt = Date.now()
        try {
          const store = await reaction.store.get(reaction.name)
          const catchUp = await catchUpSlice(reaction, store, config.eventLog, {
            advanceCursor: false,
          })
          if (!catchUp.advanced) return undefined

          observe({
            type: 'reaction-run-started',
            reactionName: reaction.name,
          })

          const result = await reaction.handle(store.read)
          if (result !== undefined) {
            let effect: unknown
            try {
              effect = await decodeOptionalSchema(reaction.outputSchema, result)
            } catch (cause) {
              throw new SpecterInvalidOutputError(
                'reaction',
                reaction.name,
                cause,
              )
            }

            const exec = await getReactionExec(reaction)
            await exec(
              effect,
              reactionDeliveryContext(
                passContext,
                reaction.name,
                catchUp.toOrder,
              ),
            )
          }

          await store.setLastAppliedOrder(catchUp.toOrder)

          observe({
            type: 'slice-caught-up',
            sliceName: reaction.name,
            fromOrder: catchUp.fromOrder,
            toOrder: catchUp.toOrder,
            eventCount: catchUp.eventCount,
          })
          observe({
            type: 'reaction-run-completed',
            reactionName: reaction.name,
            durationMs: Date.now() - startedAt,
          })

          return undefined
        } catch (cause) {
          observe({
            type: 'reaction-run-failed',
            reactionName: reaction.name,
            durationMs: Date.now() - startedAt,
            cause,
          })
          return { sliceName: reaction.name, cause }
        }
      }),
    )

    const failures = results.filter(
      (result): result is ReactionRunFailureDetail => result !== undefined,
    )
    observe({
      type: 'reaction-pass-completed',
      failureCount: failures.length,
    })
    if (failures.length) throw new ReactionRunFailure(failures)
  }

  function subscribeQuery(
    query: QuerySlice,
    input: unknown,
    options: QuerySubscriptionOptions,
  ): AsyncIterable<unknown> {
    return {
      [Symbol.asyncIterator]() {
        let state: QuerySubscriptionState

        function close() {
          if (state.closed) return

          state.closed = true
          subscriptions.delete(state)
          state.abortSignal?.removeEventListener('abort', state.abortListener)

          const pending = state.pendingNext.splice(0)
          for (const waiter of pending) {
            waiter.resolve({ done: true, value: undefined })
          }
        }

        state = {
          query,
          input,
          pendingNext: [],
          abortSignal: options.signal,
          abortListener: close,
          close,
          closed: options.signal?.aborted ?? false,
          hasBufferedValue: false,
          bufferedValue: undefined,
          hasPendingError: false,
          pendingError: undefined,
        }

        if (!state.closed) {
          subscriptions.add(state)
          options.signal?.addEventListener('abort', close, { once: true })
          void runQuery(query, input).then(
            (value) => enqueueSubscriptionValue(state, value),
            (cause: unknown) => enqueueSubscriptionError(state, cause),
          )
        }

        return {
          next() {
            if (state.closed) {
              return Promise.resolve({ done: true, value: undefined })
            }

            if (state.hasPendingError) {
              const cause = state.pendingError
              state.hasPendingError = false
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
              if (state.closed) {
                resolve({ done: true, value: undefined })
                return
              }

              state.pendingNext.push({ resolve, reject })
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

    const pending = subscription.pendingNext.shift()
    if (pending) {
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

    const pending = subscription.pendingNext.shift()
    if (pending) {
      pending.reject(cause)
      return
    }

    subscription.pendingError = cause
    subscription.hasPendingError = true
  }

  async function invalidateSubscriptions() {
    const changedEventTypes = new Set(pendingInvalidationEventTypes)
    pendingInvalidationEventTypes.clear()
    if (!changedEventTypes.size || !subscriptions.size) return

    const subscriptionsByQuery = new Map<QuerySlice, QuerySubscriptionState[]>()
    for (const subscription of subscriptions) {
      if (subscription.closed) continue
      const handlers = applyBySlice.get(subscription.query)
      if (
        ![...(handlers?.keys() ?? [])].some((type) =>
          changedEventTypes.has(type),
        )
      ) {
        continue
      }

      const active = subscriptionsByQuery.get(subscription.query) ?? []
      active.push(subscription)
      subscriptionsByQuery.set(subscription.query, active)
    }

    await Promise.all(
      [...subscriptionsByQuery].map(async ([query, activeSubscriptions]) => {
        try {
          await query.store.transaction(query.name, async (store) => {
            await catchUpSlice(query, store)

            await Promise.all(
              activeSubscriptions.map(async (subscription) => {
                try {
                  let parsedInput: unknown
                  try {
                    parsedInput = await decodeOptionalSchema(
                      query.inputSchema,
                      subscription.input,
                    )
                  } catch (cause) {
                    throw new SpecterInvalidInputError(
                      'query',
                      query.name,
                      cause,
                    )
                  }
                  const result = await query.handle(parsedInput, store.read)
                  let value: unknown
                  try {
                    value = await decodeOptionalSchema(
                      query.outputSchema,
                      result,
                    )
                  } catch (cause) {
                    throw new SpecterInvalidOutputError(
                      'query',
                      query.name,
                      cause,
                    )
                  }
                  enqueueSubscriptionValue(subscription, value)
                } catch (cause) {
                  enqueueSubscriptionError(
                    subscription,
                    isPublicSpecterError(cause)
                      ? cause
                      : new SpecterInfrastructureError(
                          `Query "${query.name}" failed while invalidating a subscription.`,
                          cause,
                        ),
                  )
                }
              }),
            )
          })
          observe({
            type: 'subscriptions-invalidated',
            queryName: query.name,
            subscriberCount: activeSubscriptions.length,
          })
        } catch (cause) {
          const error = isPublicSpecterError(cause)
            ? cause
            : new SpecterInfrastructureError(
                `Query "${query.name}" failed while catching up subscription state.`,
                cause,
              )
          for (const subscription of activeSubscriptions) {
            enqueueSubscriptionError(subscription, error)
          }
        }
      }),
    )
  }
}

async function decodeCommandInput(command: CommandSlice, input: unknown) {
  try {
    return await decodeOptionalSchema(command.inputSchema, input)
  } catch (cause) {
    throw new SpecterInvalidInputError('command', command.name, cause)
  }
}

function validateCommandOptions(options: CommandExecutionOptions) {
  if (
    options.expectedVersion !== undefined &&
    (!Number.isSafeInteger(options.expectedVersion) ||
      options.expectedVersion < 0)
  ) {
    throw new SpecterInvalidCommandOptionsError(
      'expectedVersion must be a non-negative safe integer.',
    )
  }

  if (
    options.idempotencyKey !== undefined &&
    options.idempotencyKey.trim().length === 0
  ) {
    throw new SpecterInvalidCommandOptionsError(
      'idempotencyKey must not be empty.',
    )
  }
}

function assertEventLogOrder(
  afterOrder: number,
  events: readonly PersistedEvent[],
) {
  let previousOrder = afterOrder
  for (const event of events) {
    if (
      !Number.isSafeInteger(event.order) ||
      event.order <= afterOrder ||
      event.order <= previousOrder
    ) {
      throw new SpecterEventLogOrderError(
        afterOrder,
        events.map(({ order }) => order),
      )
    }
    previousOrder = event.order
  }
}

function reactionDeliveryContext(
  pass: ReactionDeliveryContext,
  reactionName: string,
  throughOrder: number,
): ReactionDeliveryContext {
  const suffix = `${reactionName}:${throughOrder}`
  return {
    deliveryId: `${pass.deliveryId}:${suffix}`,
    scheduledAt: pass.scheduledAt,
    attemptId: `${pass.attemptId}:${suffix}`,
    attemptNumber: pass.attemptNumber,
  }
}

async function fingerprintCommand(
  commandType: string,
  decodedPayload: unknown,
) {
  let serialized: string
  try {
    serialized = canonicalSerialize(
      { type: commandType, payload: decodedPayload },
      new Set(),
    )
  } catch (cause) {
    throw new SpecterInvalidCommandOptionsError(
      'Commands using idempotencyKey must contain structurally serializable payloads.',
      { cause },
    )
  }

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(serialized),
  )
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return `v2:${hash}`
}

function canonicalSerialize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'string':
      return JSON.stringify(value)
    case 'number':
      if (Number.isNaN(value)) return 'number:NaN'
      if (value === Number.POSITIVE_INFINITY) return 'number:Infinity'
      if (value === Number.NEGATIVE_INFINITY) return 'number:-Infinity'
      if (Object.is(value, -0)) return 'number:-0'
      return `number:${String(value)}`
    case 'bigint':
      return `bigint:${String(value)}`
    case 'undefined':
      return 'undefined'
    case 'function':
    case 'symbol':
      throw new TypeError(`Unsupported value: ${typeof value}`)
    case 'object': {
      if (ancestors.has(value)) throw new TypeError('Cyclic value')
      ancestors.add(value)
      try {
        if (value instanceof Date) return `date:${value.toISOString()}`
        if (Array.isArray(value)) {
          return `[${value
            .map((item) => canonicalSerialize(item, ancestors))
            .join(',')}]`
        }

        const prototype = Object.getPrototypeOf(value)
        if (prototype !== Object.prototype && prototype !== null) {
          throw new TypeError('Only plain objects are supported')
        }
        if (Object.getOwnPropertySymbols(value).length > 0) {
          throw new TypeError('Symbol keys are unsupported')
        }

        return `{${Object.keys(value)
          .sort()
          .map(
            (key) =>
              `${JSON.stringify(key)}:${canonicalSerialize(
                (value as Record<string, unknown>)[key],
                ancestors,
              )}`,
          )
          .join(',')}}`
      } finally {
        ancestors.delete(value)
      }
    }
  }

  throw new TypeError('Unsupported value')
}

function isPublicSpecterError(cause: unknown) {
  return cause instanceof SpecterError || cause instanceof ReactionRunFailure
}
