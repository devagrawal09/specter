import {
  Clock,
  Context,
  Effect,
  Layer,
  ManagedRuntime,
  Option,
  Queue,
  Stream,
} from 'effect'

import {
  EventLog,
  type EventLogAppendResult,
  type EventLogCommit,
  EventLogFailure,
  ReactionScheduler,
  ReactionSchedulerFailure,
  type ReactionScheduleContext,
  type SliceStoreService,
  type SliceStoreTag,
} from '../adapters'
import {
  assertConforms,
  commandScenarioEventTypes,
  decodeOptionalSchema,
  type ApplyEventDefinition,
  type ApplyRegistration,
  type CommandEnvelope,
  type EventDraft,
  type PersistedEvent,
  type QuerySlice,
  type ReactionDeliveryContext,
  type ReactionExec,
  type ReactionPlugin,
  type SliceRegistration,
  SpecterConformanceError,
  valuesEqual,
} from '../definition'
import type {
  CommandExecution,
  CommandExecutionOptions,
  SpecterApp,
  SpecterAppConfig,
  SpecterCommandEnvelope,
  SpecterQueryEnvelope,
  SpecterQueryResult,
} from '../runtime/app'
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
  SpecterProjectionFailedError,
  SpecterStoreConfigurationError,
  SpecterStoreFailureError,
  SpecterUnknownCommandError,
  SpecterUnknownEventError,
  SpecterUnknownQueryError,
  SpecterVersionConflictError,
} from '../runtime/errors'
import {
  SpecterIds,
  type SpecterObservation,
  type SpecterObservationDetails,
  SpecterObserver,
} from './observability'

export type SpecterEffectError =
  | SpecterError
  | SpecterConformanceError
  | EventLogFailure
  | ReactionSchedulerFailure
  | ReactionRunFailure

type StoreOf<TSlice> = TSlice extends { readonly store: infer TStore }
  ? TStore
  : never

type StoreRequirement<TStore> =
  TStore extends SliceStoreTag<
    infer TIdentifier,
    SliceStoreService<any, any, any>
  >
    ? TIdentifier
    : never

export type SpecterStoreRequirements<TConfig extends SpecterAppConfig> =
  StoreRequirement<StoreOf<TConfig['slices'][keyof TConfig['slices']]>>

export type SpecterRuntimeRequirements<TConfig extends SpecterAppConfig> =
  | SpecterStoreRequirements<TConfig>
  | EventLog

export type SpecterEffectCommandExecution = Omit<
  CommandExecution,
  'reactions'
> & {
  readonly reactions: Effect.Effect<void, SpecterEffectError>
}

export type SpecterEffectApp<TConfig extends SpecterAppConfig> = {
  readonly command: <const TCommand extends SpecterCommandEnvelope<TConfig>>(
    command: TCommand,
    options?: CommandExecutionOptions,
  ) => Effect.Effect<SpecterEffectCommandExecution, SpecterEffectError>
  readonly query: <const TQuery extends SpecterQueryEnvelope<TConfig>>(
    query: TQuery,
  ) => Effect.Effect<
    SpecterQueryResult<TConfig, TQuery['type']>,
    SpecterEffectError
  >
  readonly subscribe: <const TQuery extends SpecterQueryEnvelope<TConfig>>(
    query: TQuery,
  ) => Stream.Stream<
    SpecterQueryResult<TConfig, TQuery['type']>,
    SpecterEffectError
  >
}

export type SpecterRuntimeService = {
  readonly command: (
    command: CommandEnvelope,
    options?: CommandExecutionOptions,
  ) => Effect.Effect<SpecterEffectCommandExecution, SpecterEffectError>
  readonly query: (
    query: CommandEnvelope,
  ) => Effect.Effect<unknown, SpecterEffectError>
  readonly subscribe: (
    query: CommandEnvelope,
  ) => Stream.Stream<unknown, SpecterEffectError>
}

export class SpecterRuntime extends Context.Service<
  SpecterRuntime,
  SpecterRuntimeService
>()('@specter-ts/core/SpecterRuntime') {}

type ResolvedStore = {
  readonly service: SliceStoreService<unknown, unknown, unknown>
}

type Subscription = {
  readonly query: QuerySlice
  readonly queue: Queue.Queue<void, any>
}

type AnyCommand = Extract<SliceRegistration, { readonly kind: 'command' }>
type AnyQuery = Extract<SliceRegistration, { readonly kind: 'query' }>
type AnyReaction = Extract<SliceRegistration, { readonly kind: 'reaction' }>

/** Native Effect interpreter. Slice callbacks stay ordinary async functions. */
export function makeSpecterRuntime<const TConfig extends SpecterAppConfig>(
  config: TConfig,
): Effect.Effect<
  SpecterEffectApp<TConfig>,
  SpecterEffectError,
  SpecterRuntimeRequirements<TConfig> | import('effect').Scope.Scope
> {
  return Effect.gen(function* () {
    yield* assertConforms(config)

    const eventLog = yield* EventLog
    const scheduler = yield* ReactionScheduler
    const observer = yield* SpecterObserver
    const ids = yield* SpecterIds
    const services = yield* Effect.context<SpecterStoreRequirements<TConfig>>()
    const eventDefinitions = new Map<string, ApplyEventDefinition>()
    const commands = new Map<string, AnyCommand>()
    const queries = new Map<string, AnyQuery>()
    const reactions = new Map<string, AnyReaction>()
    const stores = new Map<SliceRegistration, ResolvedStore>()
    const applyBySlice = new Map<
      SliceRegistration,
      ReadonlyMap<string, ApplyRegistration>
    >()
    const allowedCommandEvents = new Map<AnyCommand, ReadonlySet<string>>()
    const reactionExecs = new Map<string, ReactionExec>()
    const subscriptions = new Set<Subscription>()

    for (const eventDefinition of config.events) {
      eventDefinitions.set(eventDefinition.type, eventDefinition)
    }

    for (const slice of Object.values(config.slices)) {
      if (slice.kind === 'command') {
        commands.set(slice.name, slice)
        allowedCommandEvents.set(slice, commandScenarioEventTypes(slice))
      } else if (slice.kind === 'query') {
        queries.set(slice.name, slice)
      } else {
        reactions.set(slice.name, slice)
      }
      applyBySlice.set(
        slice,
        new Map(slice.apply.map((apply) => [apply.event.type, apply] as const)),
      )
      stores.set(slice, yield* resolveStore(slice, services))
    }

    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        subscriptions,
        (subscription) => Queue.shutdown(subscription.queue),
        { discard: true },
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            subscriptions.clear()
          }),
        ),
      ),
    )

    yield* Effect.forEach(reactions.values(), getReactionExec, {
      discard: true,
    })

    const reactionScheduler =
      reactions.size === 0
        ? undefined
        : yield* scheduler.bind({
            execute: runReactions,
            reconcile: Effect.gen(function* () {
              const currentVersion = yield* eventLog.currentVersion
              const scheduledAt = new Date(
                yield* Clock.currentTimeMillis,
              ).toISOString()
              yield* runReactions({ throughOrder: currentVersion, scheduledAt })
            }),
          })

    for (const slice of Object.values(config.slices)) {
      if (slice.eager) {
        yield* catchUpSlice(slice)
      }
    }

    const runtime: SpecterRuntimeService = Object.freeze({
      command: dispatchCommand,
      query: dispatchQuery,
      subscribe: dispatchSubscription,
    })
    return runtime as unknown as SpecterEffectApp<TConfig>

    function dispatchCommand(
      envelope: CommandEnvelope,
      options: CommandExecutionOptions = {},
    ): Effect.Effect<SpecterEffectCommandExecution, SpecterEffectError> {
      return Effect.gen(function* () {
        const optionError = validateCommandOptions(options)
        if (optionError) return yield* Effect.fail(optionError)
        const operationId = yield* ids.next
        const startedAt = yield* Clock.currentTimeMillis
        yield* observe(operationId, {
          type: 'command-started',
          commandType: envelope.type,
        })
        const command = commands.get(envelope.type)
        if (!command) {
          return yield* Effect.fail(
            new SpecterUnknownCommandError(envelope.type),
          )
        }

        const parsed = yield* decodeInput(
          'command',
          command.name,
          command.inputSchema,
          envelope.payload,
        )
        const fingerprint = options.idempotencyKey
          ? yield* fromPromise(
              () => fingerprintCommand(command.name, parsed),
              (cause) =>
                new SpecterInfrastructureError(
                  `Command "${command.name}" fingerprint failed.`,
                  cause,
                ),
            )
          : undefined
        const commit = yield* runCommand(command, parsed, {
          ...options,
          fingerprint,
        })

        yield* invalidateSubscriptions(commit.events)
        yield* reactionScheduler?.request(commit.version) ?? Effect.void
        const reactionsCompletion =
          reactionScheduler?.await(commit.version) ?? Effect.void

        for (const event of commit.events) {
          yield* observe(operationId, {
            type: 'event-persisted',
            event: eventReference(event, commit.version),
          })
        }
        const completedAt = yield* Clock.currentTimeMillis
        yield* observe(operationId, {
          type: 'command-completed',
          commandType: command.name,
          version: commit.version,
          events: commit.events.map((event) =>
            eventReference(event, commit.version),
          ),
          duplicate: commit.duplicate,
          durationMs: completedAt - startedAt,
        })

        return {
          operationId,
          events: commit.events,
          version: commit.version,
          duplicate: commit.duplicate,
          reactions: reactionsCompletion,
        }
      })
    }

    function dispatchQuery(
      envelope: CommandEnvelope,
    ): Effect.Effect<unknown, SpecterEffectError> {
      const query = queries.get(envelope.type)
      return query
        ? runQuery(query, envelope.payload)
        : Effect.fail(new SpecterUnknownQueryError(envelope.type))
    }

    function dispatchSubscription(
      envelope: CommandEnvelope,
    ): Stream.Stream<unknown, SpecterEffectError> {
      const query = queries.get(envelope.type)
      if (!query)
        return Stream.fail(new SpecterUnknownQueryError(envelope.type))

      const triggers = Stream.callback<void>(
        (queue) =>
          Effect.gen(function* () {
            const subscription = { query, queue }
            subscriptions.add(subscription)
            Queue.offerUnsafe(queue, undefined)
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                subscriptions.delete(subscription)
              }),
            )
          }),
        { bufferSize: 1, strategy: 'sliding' },
      )
      return triggers.pipe(
        Stream.mapEffect(() => runQuery(query, envelope.payload)),
      )
    }

    function runCommand(
      command: AnyCommand,
      parsed: unknown,
      options: CommandExecutionOptions & { readonly fingerprint?: string },
    ): Effect.Effect<EventLogAppendResult, SpecterEffectError> {
      return Effect.gen(function* () {
        if (options.idempotencyKey) {
          const previous = yield* eventLog.findCommit(options.idempotencyKey)
          if (previous) {
            if (previous.fingerprint !== options.fingerprint) {
              return yield* Effect.fail(
                new SpecterIdempotencyConflictError(options.idempotencyKey),
              )
            }
            return { ...previous, duplicate: true }
          }
        }

        const version = yield* eventLog.currentVersion
        if (
          options.expectedVersion !== undefined &&
          options.expectedVersion !== version
        ) {
          return yield* Effect.fail(
            new SpecterVersionConflictError(options.expectedVersion, version),
          )
        }

        yield* catchUpSlice(command)
        const events = yield* readStore(command, (read) =>
          fromPromise(
            () => command.handle(parsed, read),
            (cause) =>
              cause instanceof SpecterCommandRejectedError
                ? cause
                : new SpecterCommandRejectedError(command.name, cause),
          ),
        )
        if (events.length === 0) {
          return yield* Effect.fail(
            new SpecterCommandRejectedError(
              command.name,
              new Error('Command emitted no Events.'),
            ),
          )
        }

        const allowed = allowedCommandEvents.get(command)
        for (const [index, draft] of events.entries()) {
          if (!allowed?.has(draft.type)) {
            return yield* Effect.fail(
              new SpecterInfrastructureError(
                `Command "${command.name}" emitted unauthorized Event "${draft.type}" at index ${index}.`,
                undefined,
              ),
            )
          }
        }
        const decoded = yield* Effect.forEach(events, decodeEventDraft)
        return yield* eventLog.append(decoded, {
          expectedVersion: version,
          idempotencyKey: options.idempotencyKey,
          fingerprint: options.fingerprint,
        })
      })
    }

    function runQuery(
      query: AnyQuery,
      input: unknown,
    ): Effect.Effect<unknown, SpecterEffectError> {
      return Effect.gen(function* () {
        const parsed = yield* decodeInput(
          'query',
          query.name,
          query.inputSchema,
          input,
        )
        yield* catchUpSlice(query)
        const result = yield* readStore(query, (read) =>
          fromPromise(
            () => query.handle(parsed, read),
            (cause) =>
              new SpecterInfrastructureError(
                `Query "${query.name}" handler failed.`,
                cause,
              ),
          ),
        )
        return yield* fromPromise(
          () => decodeOptionalSchema(query.outputSchema, result),
          (cause) => new SpecterInvalidOutputError('query', query.name, cause),
        )
      })
    }

    function catchUpSlice(
      slice: SliceRegistration,
      throughOrder?: number,
    ): Effect.Effect<void, SpecterEffectError> {
      const resolved = stores.get(slice)
      if (!resolved) {
        return Effect.fail(
          new SpecterStoreConfigurationError(
            slice.name,
            `Slice "${slice.name}" has no Store binding.`,
          ),
        )
      }
      return resolved.service
        .transaction(slice.name, (write, _read, cursor, publishCursor) =>
          Effect.gen(function* () {
            const handlers = applyBySlice.get(slice)
            const eventTypes = [...(handlers?.keys() ?? [])]
            if (eventTypes.length === 0) return
            const loaded = yield* eventLog.query(cursor, eventTypes)
            const events =
              throughOrder === undefined
                ? loaded
                : loaded.filter((event) => event.order <= throughOrder)
            assertEventLogOrder(cursor, events)
            if (events.length === 0) return
            for (const event of yield* Effect.forEach(
              events,
              decodePersistedEvent,
            )) {
              const apply = handlers?.get(event.type)
              if (!apply) continue
              yield* fromPromise(
                () => apply.handle(event, write),
                (cause) => new SpecterProjectionFailedError(slice.name, cause),
              )
            }
            yield* publishCursor(events[events.length - 1].order)
          }),
        )
        .pipe(
          Effect.mapError((cause) =>
            isPublicError(cause)
              ? cause
              : new SpecterStoreFailureError(slice.name, 'transaction', cause),
          ),
        )
    }

    function readStore<A>(
      slice: SliceRegistration,
      use: (
        read: unknown,
        cursor: number,
      ) => Effect.Effect<A, SpecterEffectError>,
    ): Effect.Effect<A, SpecterEffectError> {
      const resolved = stores.get(slice)
      if (!resolved) {
        return Effect.fail(
          new SpecterStoreConfigurationError(
            slice.name,
            `Slice "${slice.name}" has no Store binding.`,
          ),
        )
      }
      return resolved.service
        .read(slice.name, use)
        .pipe(
          Effect.mapError((cause) =>
            isPublicError(cause)
              ? cause
              : new SpecterStoreFailureError(slice.name, 'read', cause),
          ),
        )
    }

    function runReactions(
      context: ReactionScheduleContext,
    ): Effect.Effect<void, ReactionRunFailure> {
      return Effect.gen(function* () {
        const failures = yield* Effect.forEach(
          [...reactions.values()],
          (reaction) =>
            runReactionThrough(reaction, context.throughOrder).pipe(
              Effect.match({
                onFailure: (cause) => ({ sliceName: reaction.name, cause }),
                onSuccess: () => undefined,
              }),
            ),
          { concurrency: 'unbounded' },
        )
        const defined = failures.filter(
          (failure) => failure !== undefined,
        ) as readonly ReactionRunFailureDetail[]
        if (defined.length > 0) {
          return yield* Effect.fail(new ReactionRunFailure(defined))
        }
      })
    }

    function runReactionThrough(
      reaction: AnyReaction,
      throughOrder: number,
    ): Effect.Effect<void, SpecterEffectError> {
      return Effect.gen(function* () {
        const cursor = yield* readStore(reaction, (_read, current) =>
          Effect.succeed(current),
        )
        const commits = yield* eventLog.commitsAfter(cursor)
        for (const commit of commits) {
          if (commit.version > throughOrder) break
          yield* runReactionCommit(reaction, commit)
        }
      })
    }

    function runReactionCommit(
      reaction: AnyReaction,
      commit: EventLogCommit,
    ): Effect.Effect<void, SpecterEffectError> {
      const resolved = stores.get(reaction)
      if (!resolved) {
        return Effect.fail(
          new SpecterStoreConfigurationError(
            reaction.name,
            `Slice "${reaction.name}" has no Store binding.`,
          ),
        )
      }
      return Effect.gen(function* () {
        const execute = yield* getReactionExec(reaction)
        const operationId = yield* ids.next
        const deliveryId = `${reaction.name}:${commit.version}`
        const startedAt = yield* Clock.currentTimeMillis
        yield* observe(operationId, {
          type: 'reaction-run-started',
          reactionName: reaction.name,
          deliveryId,
          commitVersion: commit.version,
        })
        yield* resolved.service.transaction(
          reaction.name,
          (write, read, cursor, publishCursor) =>
            Effect.gen(function* () {
              if (cursor >= commit.version) return
              const handlers = applyBySlice.get(reaction)
              const relevant = commit.events.filter(
                (event) => event.order > cursor && handlers?.has(event.type),
              )
              assertEventLogOrder(cursor, relevant)
              for (const event of yield* Effect.forEach(
                relevant,
                decodePersistedEvent,
              )) {
                const apply = handlers?.get(event.type)
                if (!apply) continue
                yield* fromPromise(
                  () => apply.handle(event, write),
                  (cause) =>
                    new SpecterProjectionFailedError(reaction.name, cause),
                )
              }
              if (relevant.length > 0) {
                const result = yield* fromPromise(
                  () => reaction.handle(read()),
                  (cause) =>
                    new SpecterInfrastructureError(
                      `Reaction "${reaction.name}" handler failed.`,
                      cause,
                    ),
                )
                if (result !== undefined) {
                  const output = yield* fromPromise(
                    () => decodeOptionalSchema(reaction.outputSchema, result),
                    (cause) =>
                      new SpecterInvalidOutputError(
                        'reaction',
                        reaction.name,
                        cause,
                      ),
                  )
                  const context: ReactionDeliveryContext = {
                    deliveryId,
                    throughOrder: commit.version,
                    scheduledAt: commit.committedAt,
                  }
                  yield* execute(output, context).pipe(
                    Effect.mapError((cause) =>
                      isPublicError(cause)
                        ? cause
                        : new SpecterInfrastructureError(
                            `Reaction "${reaction.name}" effect failed.`,
                            cause,
                          ),
                    ),
                  )
                }
              }
              yield* publishCursor(commit.version)
            }),
        )
        const completedAt = yield* Clock.currentTimeMillis
        yield* observe(operationId, {
          type: 'reaction-run-completed',
          reactionName: reaction.name,
          deliveryId,
          commitVersion: commit.version,
          durationMs: completedAt - startedAt,
        })
      }).pipe(
        Effect.mapError((cause) =>
          isPublicError(cause)
            ? cause
            : new SpecterStoreFailureError(reaction.name, 'transaction', cause),
        ),
      )
    }

    function getReactionExec(
      reaction: AnyReaction,
    ): Effect.Effect<ReactionExec, SpecterEffectError> {
      const cached = reactionExecs.get(reaction.name)
      if (cached) return Effect.succeed(cached)
      const command = (
        envelope: CommandEnvelope,
        options?: CommandExecutionOptions,
      ) => dispatchCommand(envelope, options).pipe(Effect.asVoid)
      const plugin: ReactionPlugin =
        reaction.plugin ??
        (() =>
          Effect.succeed((output: unknown, context: ReactionDeliveryContext) =>
            typeof output === 'object' &&
            output !== null &&
            'type' in output &&
            typeof output.type === 'string' &&
            'payload' in output
              ? command(
                  { type: output.type, payload: output.payload },
                  { idempotencyKey: context.deliveryId },
                )
              : Effect.fail(
                  new SpecterInfrastructureError(
                    `Reaction "${reaction.name}" uses default Command Plugin but returned a non-Command envelope.`,
                    output,
                  ),
                ),
          ))
      return plugin(command).pipe(
        Effect.map((execute) => {
          reactionExecs.set(reaction.name, execute)
          return execute
        }),
        Effect.mapError(
          (cause) =>
            new SpecterInfrastructureError(
              `Reaction "${reaction.name}" plugin initialization failed.`,
              cause,
            ),
        ),
        Effect.provide(services),
      ) as Effect.Effect<ReactionExec, SpecterEffectError>
    }

    function invalidateSubscriptions(
      events: readonly PersistedEvent[],
    ): Effect.Effect<void> {
      if (events.length === 0) return Effect.void
      const changed = new Set(events.map((event) => event.type))
      return Effect.sync(() => {
        for (const subscription of subscriptions) {
          const handlers = applyBySlice.get(subscription.query)
          if ([...(handlers?.keys() ?? [])].some((type) => changed.has(type))) {
            Queue.offerUnsafe(subscription.queue, undefined)
          }
        }
      })
    }

    function observe(
      operationId: string,
      details: SpecterObservationDetails,
    ): Effect.Effect<void> {
      return Effect.gen(function* () {
        const observationId = yield* ids.next
        const observedAt = new Date(
          yield* Clock.currentTimeMillis,
        ).toISOString()
        yield* observer.observe({
          ...details,
          observationId,
          observedAt,
          operationId,
          parentOperationIds: [],
          causedByEvents: [],
        } as SpecterObservation)
      })
    }

    function decodePersistedEvent(
      event: PersistedEvent,
    ): Effect.Effect<PersistedEvent, SpecterEffectError> {
      const definition = eventDefinitions.get(event.type)
      if (!definition)
        return Effect.fail(new SpecterUnknownEventError(event.type))
      return fromPromise(
        async () => {
          const payload = await definition.decode(event.payload)
          if (!valuesEqual(payload, event.payload)) {
            throw new SpecterInfrastructureError(
              `Event schema transformed persisted payload for "${event.type}".`,
              undefined,
            )
          }
          return { ...event, payload }
        },
        preservePublicError(
          `Event schema rejected persisted payload for "${event.type}".`,
        ),
      )
    }

    function decodeEventDraft(
      draft: EventDraft,
    ): Effect.Effect<EventDraft, SpecterEffectError> {
      const definition = eventDefinitions.get(draft.type)
      if (!definition)
        return Effect.fail(new SpecterUnknownEventError(draft.type))
      return fromPromise(
        async () => {
          const payload = await definition.decode(draft.payload)
          if (!valuesEqual(payload, draft.payload)) {
            throw new SpecterInfrastructureError(
              `Event schema transformed payload for "${draft.type}".`,
              undefined,
            )
          }
          return { ...draft, payload }
        },
        preservePublicError(
          `Event schema rejected payload for "${draft.type}".`,
        ),
      )
    }
  })
}

export function createSpecterAppLayer<const TConfig extends SpecterAppConfig>(
  config: TConfig,
): Layer.Layer<
  SpecterRuntime,
  SpecterEffectError,
  SpecterRuntimeRequirements<TConfig>
> {
  return Layer.effect(
    SpecterRuntime,
    makeSpecterRuntime(config) as Effect.Effect<
      SpecterRuntimeService,
      SpecterEffectError,
      SpecterRuntimeRequirements<TConfig> | import('effect').Scope.Scope
    >,
  )
}

/** Sole Promise bridge, intended only for HTTP/WebSocket transport edges. */
export function createSpecterPromiseApp<const TConfig extends SpecterAppConfig>(
  config: TConfig,
  dependencies: Layer.Layer<SpecterRuntimeRequirements<TConfig>>,
): SpecterApp<TConfig> {
  const runtime = ManagedRuntime.make(
    createSpecterAppLayer(config).pipe(Layer.provide(dependencies)),
  )
  const service = runtime.runPromise(Effect.service(SpecterRuntime))
  let closed = false
  return Object.freeze({
    command: async (command, options) => {
      const execution = await runtime.runPromise(
        (await service).command(command, options),
      )
      return {
        ...execution,
        reactions: runtime.runPromise(execution.reactions),
      }
    },
    query: async (query) =>
      runtime.runPromise((await service).query(query)) as Promise<never>,
    subscribe: (query, options) => ({
      async *[Symbol.asyncIterator]() {
        if (options?.signal?.aborted) return
        const stream = (await service).subscribe(query)
        const iterable = Stream.toAsyncIterable(stream)
        const iterator = iterable[Symbol.asyncIterator]()
        const abort = () => void iterator.return?.()
        options?.signal?.addEventListener('abort', abort, { once: true })
        try {
          while (!options?.signal?.aborted) {
            const next = await iterator.next()
            if (next.done) return
            yield next.value as never
          }
        } catch (cause) {
          if (!closed && !options?.signal?.aborted) throw cause
        } finally {
          options?.signal?.removeEventListener('abort', abort)
          await iterator.return?.()
        }
      },
    }),
    close: async () => {
      if (closed) return
      closed = true
      await runtime.dispose()
    },
  }) as SpecterApp<TConfig>
}

function resolveStore(
  slice: SliceRegistration,
  services: Context.Context<any>,
): Effect.Effect<ResolvedStore, SpecterStoreConfigurationError> {
  if (!isStoreTag(slice.store)) {
    return Effect.fail(
      new SpecterStoreConfigurationError(
        slice.name,
        `Slice "${slice.name}" Store binding is not an Effect Context.Tag.`,
      ),
    )
  }
  const found = Context.getOption(services, slice.store as never)
  if (Option.isNone(found)) {
    return Effect.fail(
      new SpecterStoreConfigurationError(
        slice.name,
        `Missing Store Layer for Slice "${slice.name}" (${slice.store.key}).`,
        slice.store.key,
      ),
    )
  }
  if (!isStoreService(found.value)) {
    return Effect.fail(
      new SpecterStoreConfigurationError(
        slice.name,
        `Store Layer "${slice.store.key}" does not implement SliceStoreService.`,
        slice.store.key,
      ),
    )
  }
  return Effect.succeed({ service: found.value })
}

function isStoreTag(
  store: SliceRegistration['store'],
): store is SliceStoreTag<unknown, SliceStoreService<any, any, any>> {
  return (
    (typeof store === 'object' || typeof store === 'function') &&
    store !== null &&
    '~effect/Context/Service' in store &&
    typeof store.key === 'string'
  )
}

function isStoreService(
  service: unknown,
): service is SliceStoreService<unknown, unknown, unknown> {
  return (
    typeof service === 'object' &&
    service !== null &&
    'read' in service &&
    typeof service.read === 'function' &&
    'transaction' in service &&
    typeof service.transaction === 'function'
  )
}

function decodeInput(
  kind: 'command' | 'query',
  name: string,
  schema: ApplyEventDefinition['schema'] | undefined,
  input: unknown,
): Effect.Effect<unknown, SpecterInvalidInputError> {
  return fromPromise(
    () => decodeOptionalSchema(schema, input),
    (cause) => new SpecterInvalidInputError(kind, name, cause),
  )
}

function eventReference(event: PersistedEvent, commitVersion: number) {
  return {
    id: event.id,
    type: event.type,
    order: event.order,
    recordedAt: event.recordedAt,
    commitVersion,
  }
}

function fromPromise<A, E>(
  run: () => PromiseLike<A>,
  mapError: (cause: unknown) => E,
): Effect.Effect<A, E> {
  return Effect.tryPromise({ try: run, catch: mapError })
}

function isPublicError(cause: unknown): cause is SpecterEffectError {
  return (
    cause instanceof SpecterError ||
    cause instanceof SpecterConformanceError ||
    cause instanceof EventLogFailure ||
    cause instanceof ReactionSchedulerFailure ||
    cause instanceof ReactionRunFailure
  )
}

function preservePublicError(message: string) {
  return (cause: unknown): SpecterEffectError =>
    isPublicError(cause)
      ? cause
      : new SpecterInfrastructureError(message, cause)
}

function validateCommandOptions(options: CommandExecutionOptions) {
  if (
    options.expectedVersion !== undefined &&
    (!Number.isSafeInteger(options.expectedVersion) ||
      options.expectedVersion < 0)
  ) {
    return new SpecterInvalidCommandOptionsError(
      'expectedVersion must be a non-negative safe integer.',
    )
  }
  if (
    options.idempotencyKey !== undefined &&
    options.idempotencyKey.trim().length === 0
  ) {
    return new SpecterInvalidCommandOptionsError(
      'idempotencyKey must not be empty.',
    )
  }
  return undefined
}

function assertEventLogOrder(
  afterOrder: number,
  events: readonly PersistedEvent[],
) {
  let previous = afterOrder
  for (const event of events) {
    if (!Number.isSafeInteger(event.order) || event.order <= previous) {
      throw new SpecterEventLogOrderError(
        afterOrder,
        events.map(({ order }) => order),
      )
    }
    previous = event.order
  }
}

async function fingerprintCommand(type: string, payload: unknown) {
  const canonical = canonicalize({ type, payload }, new WeakSet())
  const bytes = new TextEncoder().encode(canonical)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return `v2:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')}`
}

function canonicalize(value: unknown, seen: WeakSet<object>): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value)
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError('Command payload numbers must be finite.')
      }
      return Object.is(value, -0) ? '0' : String(value)
    case 'object': {
      if (seen.has(value))
        throw new TypeError('Command payload must not be cyclic.')
      seen.add(value)
      try {
        if (Array.isArray(value)) {
          return `[${value.map((item) => canonicalize(item, seen)).join(',')}]`
        }
        if (Object.getPrototypeOf(value) !== Object.prototype) {
          throw new TypeError(
            'Command payload values must be plain JSON objects.',
          )
        }
        return `{${Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(
            ([key, item]) =>
              `${JSON.stringify(key)}:${canonicalize(item, seen)}`,
          )
          .join(',')}}`
      } finally {
        seen.delete(value)
      }
    }
    default:
      throw new TypeError(
        `Command payload contains unsupported ${typeof value}.`,
      )
  }
}
