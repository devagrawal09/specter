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

export type SpecterEventReference = {
  readonly id: string
  readonly type: string
  readonly order: number
  readonly recordedAt: string
  /** Present when the observing runtime knows which commit produced the Event. */
  readonly commitVersion?: number
}

export type SpecterEventOrderRange = {
  readonly fromOrder: number
  readonly toOrder: number
  readonly eventCount: number
}

export type SpecterCausality = {
  readonly correlationId?: string
  readonly parentOperationIds: readonly string[]
  readonly causedByEvents: readonly SpecterEventReference[]
}

type SpecterObservationBase = SpecterCausality & {
  readonly observationId: string
  readonly observedAt: string
  readonly operationId: string
}

export type SpecterObservation = SpecterObservationBase &
  (
    | {
        readonly type: 'command-started'
        readonly commandType: string
      }
    | {
        readonly type: 'command-completed'
        readonly commandType: string
        readonly version: number
        readonly events: readonly SpecterEventReference[]
        readonly duplicate: boolean
        readonly durationMs: number
      }
    | {
        readonly type: 'command-rejected'
        readonly commandType: string
        readonly durationMs: number
        readonly cause: unknown
      }
    | {
        readonly type: 'command-failed'
        readonly commandType: string
        readonly durationMs: number
        readonly cause: unknown
      }
    | {
        readonly type: 'event-persisted'
        readonly event: SpecterEventReference
      }
    | {
        readonly type: 'query-started'
        readonly queryName: string
        readonly subscription: boolean
      }
    | {
        readonly type: 'query-completed'
        readonly queryName: string
        readonly subscription: boolean
        readonly durationMs: number
      }
    | {
        readonly type: 'query-rejected'
        readonly queryName: string
        readonly subscription: boolean
        readonly durationMs: number
        readonly cause: unknown
      }
    | {
        readonly type: 'query-failed'
        readonly queryName: string
        readonly subscription: boolean
        readonly durationMs: number
        readonly cause: unknown
      }
    | {
        readonly type: 'slice-caught-up'
        readonly sliceName: string
        readonly sliceKind: SliceRegistration['kind']
        readonly fromOrder: number
        readonly toOrder: number
        readonly eventCount: number
        readonly events: readonly SpecterEventReference[]
      }
    | {
        readonly type: 'subscriptions-invalidated'
        readonly queryName: string
        readonly subscriberCount: number
        readonly changedEventTypes: readonly string[]
      }
    | {
        readonly type: 'reaction-pass-started'
        readonly passId: string
        readonly attemptId: string
        readonly attemptNumber: number
      }
    | {
        readonly type: 'reaction-run-started'
        readonly reactionName: string
        readonly runId: string
        readonly passId: string
        readonly attemptId: string
        readonly eventRange?: SpecterEventOrderRange
      }
    | {
        readonly type: 'reaction-run-completed'
        readonly reactionName: string
        readonly runId: string
        readonly passId: string
        readonly attemptId: string
        readonly eventRange: SpecterEventOrderRange
        readonly durationMs: number
      }
    | {
        readonly type: 'reaction-run-failed'
        readonly reactionName: string
        readonly runId: string
        readonly passId: string
        readonly attemptId: string
        readonly eventRange?: SpecterEventOrderRange
        readonly durationMs: number
        readonly cause: unknown
      }
    | {
        readonly type: 'reaction-pass-completed'
        readonly passId: string
        readonly attemptId: string
        readonly attemptNumber: number
        readonly eventRanges: readonly SpecterEventOrderRange[]
        readonly failureCount: number
        readonly durationMs: number
      }
    | {
        readonly type: 'reaction-pass-failed'
        readonly passId: string
        readonly attemptId: string
        readonly attemptNumber: number
        readonly eventRanges: readonly SpecterEventOrderRange[]
        readonly failureCount: number
        readonly durationMs: number
        readonly cause: unknown
      }
  )

export type SpecterObserver = (observation: SpecterObservation) => void

export type SpecterAppConfig = {
  readonly events: readonly ApplyEventDefinition[]
  readonly eventLog: EventLogAdapter
  readonly schedule: ReactionScheduler
  readonly slices: readonly SliceRegistration[]
  readonly observe?: SpecterObserver
  /** Runtime-only determinism seams; neither function may affect domain data. */
  readonly runtime?: SpecterRuntimeOptions
}

export type SpecterRuntimeOptions = {
  readonly generateId?: () => string
  /** Returns milliseconds since the Unix epoch. */
  readonly now?: () => number
}

export type SpecterOperationOptions = {
  /** Allows a trusted initiating boundary to preserve its protocol operation ID. */
  readonly operationId?: string
  readonly correlationId?: string
  readonly parentOperationIds?: readonly string[]
  readonly causedByEvents?: readonly SpecterEventReference[]
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

export type CommandExecutionOptions = CommandDispatchOptions &
  SpecterOperationOptions

export type CommandExecution = {
  /** Present on runtime-native executions; optional for legacy transport adapters. */
  readonly operationId?: string
  readonly events: readonly PersistedEvent[]
  readonly version: number
  readonly duplicate: boolean
  /** Settles after every independently runnable Reaction has completed. */
  readonly reactions: Promise<void>
}

export type QuerySubscriptionOptions = {
  readonly signal?: AbortSignal
} & SpecterOperationOptions

declare const specterAppConfig: unique symbol

export type SpecterApp<TConfig extends SpecterAppConfig> = {
  readonly [specterAppConfig]?: TConfig
  command: <const TCommand extends SpecterCommandEnvelope<TConfig>>(
    command: TCommand,
    options?: CommandExecutionOptions,
  ) => Promise<CommandExecution>
  query: <const TQuery extends SpecterQueryEnvelope<TConfig>>(
    query: TQuery,
    options?: SpecterOperationOptions,
  ) => Promise<SpecterQueryResult<TConfig, TQuery['type']>>
  subscribe: <const TQuery extends SpecterQueryEnvelope<TConfig>>(
    query: TQuery,
    options?: QuerySubscriptionOptions,
  ) => AsyncIterable<SpecterQueryResult<TConfig, TQuery['type']>>
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
  closed: boolean
  hasBufferedValue: boolean
  bufferedValue: unknown
  hasPendingError: boolean
  pendingError: unknown
}

type CommandCommit = EventLogAppendResult

type OperationContext = SpecterCausality & {
  readonly operationId: string
}

type SpecterObservationDetails = SpecterObservation extends infer TObservation
  ? TObservation extends SpecterObservationBase
    ? Omit<TObservation, keyof SpecterObservationBase>
    : never
  : never

type LocalEventCause = {
  readonly operationId: string
  readonly correlationId?: string
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
  const activeReactionContexts = new Map<string, OperationContext>()
  const localEventCauses = new Map<number, LocalEventCause>()
  const subscriptions = new Set<QuerySubscriptionState>()
  const pendingInvalidationEvents = new Map<number, SpecterEventReference>()

  const configuredGenerateId = config.runtime?.generateId
  const configuredNow = config.runtime?.now

  function generateId() {
    try {
      const id = configuredGenerateId?.()
      if (id) return id
    } catch {
      // Runtime diagnostic seams are best-effort, just like the observer.
    }
    return crypto.randomUUID()
  }

  function now() {
    try {
      const value = configuredNow?.()
      if (value !== undefined && Number.isFinite(value)) return value
    } catch {
      // Runtime diagnostic seams are best-effort, just like the observer.
    }
    return Date.now()
  }

  const requestReactions = config.schedule(runReactions)

  const app = Object.freeze({
    command: dispatchCommand,
    query: dispatchQuery,
    subscribe: dispatchSubscription,
  }) as SpecterApp<TConfig>

  return app

  function operationContext(options: SpecterOperationOptions = {}) {
    return {
      operationId: options.operationId || generateId(),
      correlationId: options.correlationId,
      parentOperationIds: [...(options.parentOperationIds ?? [])],
      causedByEvents: (options.causedByEvents ?? []).map(
        sanitizeEventReference,
      ),
    } satisfies OperationContext
  }

  function observe(
    context: OperationContext,
    details: SpecterObservationDetails,
  ) {
    try {
      config.observe?.({
        ...context,
        ...details,
        observationId: generateId(),
        observedAt: new Date(now()).toISOString(),
      } as SpecterObservation)
    } catch {
      // Observability is deliberately best-effort and cannot change domain
      // semantics or turn a successful commit into a failed command.
    }
  }

  async function getReactionExec(reaction: ReactionSlice<string, unknown>) {
    const cachedExec = reactionExecs.get(reaction.name)
    if (cachedExec) return cachedExec

    const exec = await reaction.plugin(
      async (command: CommandEnvelope, options?: CommandDispatchOptions) => {
        const activeContext = activeReactionContexts.get(reaction.name)
        await dispatchReactionCommand(command, options, activeContext)
      },
    )

    reactionExecs.set(reaction.name, exec)
    return exec
  }

  async function dispatchReactionCommand(
    envelope: CommandEnvelope,
    options: CommandDispatchOptions = {},
    parentContext?: OperationContext,
  ) {
    const context = operationContext({
      correlationId: parentContext?.correlationId,
      parentOperationIds: parentContext ? [parentContext.operationId] : [],
      causedByEvents: parentContext?.causedByEvents,
    })
    const commit = await observeCommand(envelope, options, context)
    if (commit.duplicate) return

    rememberCommittedEvents(commit, context)

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
    const context = operationContext(options)
    const commit = await observeCommand(envelope, options, context)

    if (commit.duplicate) {
      return {
        operationId: context.operationId,
        events: commit.events,
        version: commit.version,
        duplicate: true,
        reactions: requestReactionCompletion(
          Promise.resolve(),
          'The Reaction scheduler failed while catching up a duplicate Command.',
        ),
      }
    }

    rememberCommittedEvents(commit, context)
    const commandInvalidation = invalidateSubscriptions(context)

    const reactionsPromise = requestReactionCompletion(
      commandInvalidation,
      'The Reaction scheduler failed after the Command was committed.',
    )

    return {
      operationId: context.operationId,
      events: commit.events,
      version: commit.version,
      duplicate: false,
      reactions: reactionsPromise,
    }
  }

  async function dispatchQuery(
    envelope: SpecterQueryEnvelope<TConfig>,
    options: SpecterOperationOptions = {},
  ): Promise<unknown> {
    return observeQuery(envelope, options, false)
  }

  function dispatchSubscription(
    envelope: SpecterQueryEnvelope<TConfig>,
    options: QuerySubscriptionOptions = {},
  ): AsyncIterable<unknown> {
    const query = queries.get(envelope.type)
    if (!query) {
      const context = operationContext(options)
      const startedAt = now()
      observe(context, {
        type: 'query-started',
        queryName: envelope.type,
        subscription: true,
      })
      const cause = new SpecterUnknownQueryError(envelope.type)
      observe(context, {
        type: 'query-rejected',
        queryName: envelope.type,
        subscription: true,
        durationMs: elapsed(startedAt),
        cause,
      })
      throw cause
    }

    return subscribeQuery(query, envelope.payload, options)
  }

  async function observeCommand(
    envelope: CommandEnvelope,
    options: CommandExecutionOptions | CommandDispatchOptions,
    context: OperationContext,
  ) {
    const startedAt = now()
    observe(context, {
      type: 'command-started',
      commandType: envelope.type,
    })
    try {
      const command = commands.get(envelope.type)
      if (!command) throw new SpecterUnknownCommandError(envelope.type)

      validateCommandOptions(options)
      const fingerprint = options.idempotencyKey
        ? await fingerprintCommand(envelope)
        : undefined
      const commit = await runCommand(command, envelope.payload, {
        ...options,
        fingerprint,
        operationContext: context,
      })
      const events = eventReferences(commit.events, commit.version)
      if (!commit.duplicate) {
        for (const event of events) {
          observe(context, { type: 'event-persisted', event })
        }
      }
      observe(context, {
        type: 'command-completed',
        commandType: command.name,
        version: commit.version,
        events,
        duplicate: commit.duplicate,
        durationMs: elapsed(startedAt),
      })
      return commit
    } catch (cause) {
      observe(context, {
        type: isRejectedOperation(cause)
          ? 'command-rejected'
          : 'command-failed',
        commandType: envelope.type,
        durationMs: elapsed(startedAt),
        cause,
      })
      throw cause
    }
  }

  async function observeQuery(
    envelope: { readonly type: string; readonly payload: unknown },
    options: SpecterOperationOptions,
    subscription: boolean,
  ) {
    const context = operationContext(options)
    const startedAt = now()
    observe(context, {
      type: 'query-started',
      queryName: envelope.type,
      subscription,
    })
    try {
      const query = queries.get(envelope.type)
      if (!query) throw new SpecterUnknownQueryError(envelope.type)
      const result = await runQuery(query, envelope.payload, context)
      observe(result.operationContext, {
        type: 'query-completed',
        queryName: query.name,
        subscription,
        durationMs: elapsed(startedAt),
      })
      return result.value
    } catch (cause) {
      observe(context, {
        type: isRejectedOperation(cause) ? 'query-rejected' : 'query-failed',
        queryName: envelope.type,
        subscription,
        durationMs: elapsed(startedAt),
        cause,
      })
      throw cause
    }
  }

  function rememberCommittedEvents(
    commit: CommandCommit,
    context: OperationContext,
  ) {
    for (const event of eventReferences(commit.events, commit.version)) {
      pendingInvalidationEvents.set(event.order, event)
      localEventCauses.set(event.order, {
        operationId: context.operationId,
        correlationId: context.correlationId,
      })
      if (localEventCauses.size > 10_000) {
        const oldestOrder = localEventCauses.keys().next().value
        if (oldestOrder !== undefined) localEventCauses.delete(oldestOrder)
      }
    }
  }

  function elapsed(startedAt: number) {
    return Math.max(0, now() - startedAt)
  }

  function operationContextForEvents(
    context: OperationContext,
    events: readonly SpecterEventReference[],
  ): OperationContext {
    const localCauses = events.flatMap((event) => {
      const cause = localEventCauses.get(event.order)
      return cause ? [cause] : []
    })
    const correlationIds = [
      ...new Set(
        localCauses.flatMap((cause) =>
          cause.correlationId ? [cause.correlationId] : [],
        ),
      ),
    ]
    return {
      operationId: context.operationId,
      correlationId:
        context.correlationId ??
        (correlationIds.length === 1 ? correlationIds[0] : undefined),
      parentOperationIds: [
        ...new Set([
          ...context.parentOperationIds,
          ...localCauses.map((cause) => cause.operationId),
        ]),
      ],
      causedByEvents: deduplicateEventReferences([
        ...context.causedByEvents,
        ...events,
      ]),
    }
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
    options: {
      readonly advanceCursor?: boolean
      readonly operationContext?: OperationContext
    } = {},
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
        events: [] as readonly SpecterEventReference[],
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
        events: [] as readonly SpecterEventReference[],
      } as const
    }

    for (const event of unappliedEvents) {
      const apply = handlers?.get(event.type)
      if (apply) await apply.handle(event, store.write)
    }

    const lastEvent = unappliedEvents[unappliedEvents.length - 1]
    if (options.advanceCursor !== false) {
      await store.setLastAppliedOrder(lastEvent.order)
      if (options.operationContext) {
        const catchUpContext = operationContextForEvents(
          options.operationContext,
          eventReferences(unappliedEvents),
        )
        observe(catchUpContext, {
          type: 'slice-caught-up',
          sliceName: slice.name,
          sliceKind: slice.kind,
          fromOrder: lastAppliedOrder,
          toOrder: lastEvent.order,
          eventCount: unappliedEvents.length,
          events: eventReferences(unappliedEvents),
        })
      }
    }

    return {
      store,
      advanced: true,
      fromOrder: lastAppliedOrder,
      toOrder: lastEvent.order,
      eventCount: unappliedEvents.length,
      events: eventReferences(unappliedEvents),
    } as const
  }

  async function runCommand(
    commandSlice: CommandSlice,
    input: unknown,
    options: CommandExecutionOptions & {
      readonly fingerprint?: string
      readonly operationContext: OperationContext
    },
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

        let parsedCommand: unknown
        try {
          parsedCommand = await decodeOptionalSchema(
            commandSlice.inputSchema,
            input,
          )
        } catch (cause) {
          throw new SpecterInvalidInputError(
            'command',
            commandSlice.name,
            cause,
          )
        }

        const store = await commandSlice.store.get(commandSlice.name)
        await catchUpSlice(commandSlice, store, eventLog, {
          operationContext: options.operationContext,
        })

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

  async function runQuery(
    query: QuerySlice,
    input: unknown,
    operationContext: OperationContext,
  ) {
    try {
      return await query.store.transaction(query.name, async (store) => {
        let parsedInput: unknown
        try {
          parsedInput = await decodeOptionalSchema(query.inputSchema, input)
        } catch (cause) {
          throw new SpecterInvalidInputError('query', query.name, cause)
        }

        const catchUp = await catchUpSlice(query, store, config.eventLog, {
          operationContext,
        })
        const completedContext = operationContextForEvents(
          operationContext,
          catchUp.events,
        )

        const result = await query.handle(parsedInput, store.read)

        try {
          return {
            value: await decodeOptionalSchema(query.outputSchema, result),
            operationContext: completedContext,
          }
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
    const passStartedAt = now()
    const passOperation = operationContext()
    observe(passOperation, {
      type: 'reaction-pass-started',
      passId: passContext.deliveryId,
      attemptId: passContext.attemptId,
      attemptNumber: passContext.attemptNumber,
    })

    const results = await Promise.all(
      [...reactions.values()].map(async (reaction) => {
        const startedAt = now()
        const initialContext = operationContext({
          parentOperationIds: [passOperation.operationId],
        })
        const runId = `${passContext.attemptId}:${reaction.name}`
        let context: OperationContext = initialContext
        let eventRange: SpecterEventOrderRange | undefined
        try {
          const store = await reaction.store.get(reaction.name)
          const catchUp = await catchUpSlice(reaction, store, config.eventLog, {
            advanceCursor: false,
          })
          if (!catchUp.advanced) return undefined

          const events = catchUp.events
          context = operationContextForEvents(initialContext, events)
          eventRange = {
            fromOrder: catchUp.fromOrder,
            toOrder: catchUp.toOrder,
            eventCount: catchUp.eventCount,
          }

          observe(context, {
            type: 'reaction-run-started',
            reactionName: reaction.name,
            runId,
            passId: passContext.deliveryId,
            attemptId: passContext.attemptId,
            eventRange,
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
            activeReactionContexts.set(reaction.name, context)
            try {
              await exec(
                effect,
                reactionDeliveryContext(
                  passContext,
                  reaction.name,
                  catchUp.toOrder,
                ),
              )
            } finally {
              activeReactionContexts.delete(reaction.name)
            }
          }

          await store.setLastAppliedOrder(catchUp.toOrder)

          observe(context, {
            type: 'slice-caught-up',
            sliceName: reaction.name,
            sliceKind: reaction.kind,
            fromOrder: catchUp.fromOrder,
            toOrder: catchUp.toOrder,
            eventCount: catchUp.eventCount,
            events,
          })
          observe(context, {
            type: 'reaction-run-completed',
            reactionName: reaction.name,
            runId,
            passId: passContext.deliveryId,
            attemptId: passContext.attemptId,
            eventRange,
            durationMs: elapsed(startedAt),
          })

          return { eventRange }
        } catch (cause) {
          activeReactionContexts.delete(reaction.name)
          observe(context, {
            type: 'reaction-run-failed',
            reactionName: reaction.name,
            runId,
            passId: passContext.deliveryId,
            attemptId: passContext.attemptId,
            eventRange,
            durationMs: elapsed(startedAt),
            cause,
          })
          return { sliceName: reaction.name, cause, eventRange }
        }
      }),
    )

    const failures = results.filter(
      (
        result,
      ): result is ReactionRunFailureDetail & {
        readonly eventRange: SpecterEventOrderRange | undefined
      } => result !== undefined && 'cause' in result,
    )
    const eventRanges = mergeEventRanges(
      results.flatMap((result) =>
        result?.eventRange ? [result.eventRange] : [],
      ),
    )
    if (failures.length) {
      const cause = new ReactionRunFailure(
        failures.map(({ sliceName, cause }) => ({ sliceName, cause })),
      )
      observe(passOperation, {
        type: 'reaction-pass-failed',
        passId: passContext.deliveryId,
        attemptId: passContext.attemptId,
        attemptNumber: passContext.attemptNumber,
        eventRanges,
        failureCount: failures.length,
        durationMs: elapsed(passStartedAt),
        cause,
      })
      throw cause
    }
    observe(passOperation, {
      type: 'reaction-pass-completed',
      passId: passContext.deliveryId,
      attemptId: passContext.attemptId,
      attemptNumber: passContext.attemptNumber,
      eventRanges,
      failureCount: 0,
      durationMs: elapsed(passStartedAt),
    })
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
          closed: options.signal?.aborted ?? false,
          hasBufferedValue: false,
          bufferedValue: undefined,
          hasPendingError: false,
          pendingError: undefined,
        }

        if (!state.closed) {
          subscriptions.add(state)
          options.signal?.addEventListener('abort', close, { once: true })
          void observeQuery(
            { type: query.name, payload: input },
            options,
            true,
          ).then(
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

  async function invalidateSubscriptions(parentContext?: OperationContext) {
    const changedEvents = [...pendingInvalidationEvents.values()]
    pendingInvalidationEvents.clear()
    const changedEventTypes = new Set(changedEvents.map((event) => event.type))
    if (!changedEventTypes.size || !subscriptions.size) return

    const invalidationContext = operationContextForEvents(
      operationContext({
        correlationId: parentContext?.correlationId,
        parentOperationIds: parentContext ? [parentContext.operationId] : [],
        causedByEvents: changedEvents,
      }),
      changedEvents,
    )

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
            await catchUpSlice(query, store, config.eventLog, {
              operationContext: invalidationContext,
            })

            await Promise.all(
              activeSubscriptions.map(async (subscription) => {
                const queryContext = operationContext({
                  correlationId: invalidationContext.correlationId,
                  parentOperationIds: [invalidationContext.operationId],
                  causedByEvents: changedEvents,
                })
                const startedAt = now()
                observe(queryContext, {
                  type: 'query-started',
                  queryName: query.name,
                  subscription: true,
                })
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
                  observe(queryContext, {
                    type: 'query-completed',
                    queryName: query.name,
                    subscription: true,
                    durationMs: elapsed(startedAt),
                  })
                } catch (cause) {
                  const error = isPublicSpecterError(cause)
                    ? cause
                    : new SpecterInfrastructureError(
                        `Query "${query.name}" failed while invalidating a subscription.`,
                        cause,
                      )
                  enqueueSubscriptionError(subscription, error)
                  observe(queryContext, {
                    type: isRejectedOperation(error)
                      ? 'query-rejected'
                      : 'query-failed',
                    queryName: query.name,
                    subscription: true,
                    durationMs: elapsed(startedAt),
                    cause: error,
                  })
                }
              }),
            )
          })
          observe(invalidationContext, {
            type: 'subscriptions-invalidated',
            queryName: query.name,
            subscriberCount: activeSubscriptions.length,
            changedEventTypes: [...changedEventTypes],
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

function eventReferences(
  events: readonly PersistedEvent[],
  commitVersion?: number,
): readonly SpecterEventReference[] {
  return events.map((event) => ({
    id: event.id,
    type: event.type,
    order: event.order,
    recordedAt: event.recordedAt,
    ...(commitVersion === undefined ? {} : { commitVersion }),
  }))
}

function deduplicateEventReferences(
  events: readonly SpecterEventReference[],
): readonly SpecterEventReference[] {
  const byOrder = new Map<number, SpecterEventReference>()
  for (const event of events) {
    byOrder.set(event.order, sanitizeEventReference(event))
  }
  return [...byOrder.values()].sort((left, right) => left.order - right.order)
}

function sanitizeEventReference(
  event: SpecterEventReference,
): SpecterEventReference {
  return {
    id: event.id,
    type: event.type,
    order: event.order,
    recordedAt: event.recordedAt,
    ...(event.commitVersion === undefined
      ? {}
      : { commitVersion: event.commitVersion }),
  }
}

function mergeEventRanges(
  ranges: readonly SpecterEventOrderRange[],
): readonly SpecterEventOrderRange[] {
  const sorted = [...ranges].sort(
    (left, right) => left.fromOrder - right.fromOrder,
  )
  const merged: SpecterEventOrderRange[] = []
  for (const range of sorted) {
    const previous = merged[merged.length - 1]
    if (!previous || range.fromOrder > previous.toOrder) {
      merged.push({ ...range })
      continue
    }
    merged[merged.length - 1] = {
      fromOrder: Math.min(previous.fromOrder, range.fromOrder),
      toOrder: Math.max(previous.toOrder, range.toOrder),
      eventCount: Math.max(previous.eventCount, range.eventCount),
    }
  }
  return merged
}

function isRejectedOperation(cause: unknown) {
  if (!(cause instanceof SpecterError)) return false
  return (
    cause.code === 'SPECTER_COMMAND_REJECTED' ||
    cause.code === 'SPECTER_IDEMPOTENCY_CONFLICT' ||
    cause.code === 'SPECTER_INVALID_COMMAND_OPTIONS' ||
    cause.code === 'SPECTER_INVALID_INPUT' ||
    cause.code === 'SPECTER_UNKNOWN_COMMAND' ||
    cause.code === 'SPECTER_UNKNOWN_QUERY' ||
    cause.code === 'SPECTER_VERSION_CONFLICT'
  )
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

async function fingerprintCommand(command: CommandEnvelope) {
  let serialized: string
  try {
    serialized = canonicalSerialize(command, new Set())
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
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
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
