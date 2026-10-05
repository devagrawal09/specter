import {
  Cause,
  Context,
  Effect,
  Exit,
  Fiber,
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
  type CommandReceipt,
  type EventDraft,
  type PersistedEvent,
  type QueryDispatch,
  type QuerySlice,
  type ReactionDeliveryContext,
  type ReactionExec,
  type ReactionPlugin,
  type ReactionPluginContext,
  type ReactionPluginRequirements,
  type SliceRegistration,
  SpecterConformanceError,
  valuesEqual,
} from '../definition'
import type {
  CommandExecution,
  CommandExecutionOptions,
  PreparedSpecterApp,
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
  SpecterPluginQueryInTransactionError,
  SpecterProjectionFailedError,
  specterErrorCodes,
  SpecterStoreConfigurationError,
  SpecterStoreFailureError,
  SpecterUnknownCommandError,
  SpecterUnknownEventError,
  SpecterUnknownQueryError,
  SpecterVersionConflictError,
} from '../runtime/errors'

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

/** Effect services read by Reaction Plugin factories in the app config. */
export type SpecterPluginRequirements<TConfig extends SpecterAppConfig> =
  ReactionPluginRequirements<TConfig['slices'][keyof TConfig['slices']]>

export type SpecterRuntimeRequirements<TConfig extends SpecterAppConfig> =
  | SpecterStoreRequirements<TConfig>
  | SpecterPluginRequirements<TConfig>
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

/**
 * Marks a direct Plugin executing inside its Reaction's Slice Store
 * transaction. Outboxed Plugins execute in a fresh fiber without it.
 */
const DirectReactionExecution = Context.Reference<boolean>(
  '@specter-ts/core/DirectReactionExecution',
  { defaultValue: () => false },
)

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

/**
 * Process-local proof that every Event Log commit in `(from, through]` is
 * irrelevant to one Reaction. It only saves re-reading those commits; the
 * Slice Store cursor stays the durable truth.
 */
type ReactionSkip = { readonly from: number; readonly through: number }

/**
 * A Reaction pass publishes a cursor over skipped irrelevant commits once they
 * span this many Event Log orders, bounding re-reads after a crash. Graceful
 * shutdown publishes any shorter remembered tail.
 */
const reactionSkipFlushOrders = 256

/** Per-config work: everything derived from a conforming config alone. */
type SpecterAppPlan = {
  readonly slices: readonly SliceRegistration[]
  readonly eagerSlices: readonly SliceRegistration[]
  readonly eventDefinitions: ReadonlyMap<string, ApplyEventDefinition>
  readonly commands: ReadonlyMap<string, AnyCommand>
  readonly queries: ReadonlyMap<string, AnyQuery>
  readonly reactions: ReadonlyMap<string, AnyReaction>
  readonly applyBySlice: ReadonlyMap<
    SliceRegistration,
    ReadonlyMap<string, ApplyRegistration>
  >
  readonly allowedCommandEvents: ReadonlyMap<AnyCommand, ReadonlySet<string>>
}

type PendingPlan = Promise<Exit.Exit<SpecterAppPlan, SpecterConformanceError>>

/** Only objects created by `prepareSpecterRuntime` are registered here. */
const preparedPlans = new WeakMap<object, SpecterAppPlan>()

/**
 * Plans keyed by `config.events`, then `config.slices`. Identity is the only
 * sound key: conformance checks EventDefinition identity, and Slices carry
 * handler functions that no content digest covers. Keying the two inner
 * objects instead of the outer config lets callers rebuild `{ events, slices }`
 * per app and still hit. An entry holds the in-flight Promise so concurrent
 * first use validates once, then the settled plan so later hits stay
 * synchronous. Failed validations are evicted after every waiter has seen
 * them.
 */
const planCache = new WeakMap<
  object,
  WeakMap<object, SpecterAppPlan | PendingPlan>
>()

/**
 * Effect counterpart of `prepareSpecterApp`: runs (or reuses) conformance and
 * lookup-structure construction for a config, without any Event Log or Store.
 */
export function prepareSpecterRuntime<const TConfig extends SpecterAppConfig>(
  config: TConfig | PreparedSpecterApp<TConfig>,
): Effect.Effect<PreparedSpecterApp<TConfig>, SpecterConformanceError> {
  return Effect.suspend(() => {
    if (preparedPlans.has(config)) {
      return Effect.succeed(config as PreparedSpecterApp<TConfig>)
    }
    const raw = config as TConfig
    return cachedPlan(raw).pipe(
      Effect.map((plan) => {
        const prepared: PreparedSpecterApp<TConfig> = Object.freeze({
          _tag: 'PreparedSpecterApp',
          config: raw,
        })
        preparedPlans.set(prepared, plan)
        return prepared
      }),
    )
  })
}

function resolvePlan(
  config: SpecterAppConfig | PreparedSpecterApp,
): Effect.Effect<SpecterAppPlan, SpecterConformanceError> {
  return Effect.suspend(() => {
    const prepared = preparedPlans.get(config)
    return prepared
      ? Effect.succeed(prepared)
      : cachedPlan(config as SpecterAppConfig)
  })
}

function cachedPlan(
  config: SpecterAppConfig,
): Effect.Effect<SpecterAppPlan, SpecterConformanceError> {
  const { events, slices } = config
  if (!isObject(events) || !isObject(slices)) return buildPlan(config)
  let bySlices = planCache.get(events)
  if (!bySlices) {
    bySlices = new WeakMap()
    planCache.set(events, bySlices)
  }
  const entries = bySlices
  const cached = entries.get(slices)
  if (cached && !(cached instanceof Promise)) return Effect.succeed(cached)
  let pending = cached
  if (!pending) {
    const started = Effect.runPromiseExit(buildPlan({ events, slices }))
    entries.set(slices, started)
    void started.then((exit) => {
      if (entries.get(slices) !== started) return
      if (Exit.isSuccess(exit)) entries.set(slices, exit.value)
      else entries.delete(slices)
    })
    pending = started
  }
  const settled = pending
  return Effect.flatten(Effect.promise(() => settled))
}

function buildPlan(
  config: SpecterAppConfig,
): Effect.Effect<SpecterAppPlan, SpecterConformanceError> {
  return assertConforms(config).pipe(
    Effect.map(() => {
      const slices = Object.values(config.slices)
      const eventDefinitions = new Map<string, ApplyEventDefinition>()
      const commands = new Map<string, AnyCommand>()
      const queries = new Map<string, AnyQuery>()
      const reactions = new Map<string, AnyReaction>()
      const applyBySlice = new Map<
        SliceRegistration,
        ReadonlyMap<string, ApplyRegistration>
      >()
      const allowedCommandEvents = new Map<AnyCommand, ReadonlySet<string>>()

      for (const eventDefinition of config.events) {
        eventDefinitions.set(eventDefinition.type, eventDefinition)
      }
      for (const slice of slices) {
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
          new Map(
            slice.apply.map((apply) => [apply.event.type, apply] as const),
          ),
        )
      }

      return {
        slices,
        eagerSlices: slices.filter((slice) => slice.eager),
        eventDefinitions,
        commands,
        queries,
        reactions,
        applyBySlice,
        allowedCommandEvents,
      }
    }),
  )
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

/**
 * Native Effect interpreter. Slice callbacks stay ordinary async functions.
 *
 * Accepts a raw config (validated through the shared per-config cache) or a
 * `PreparedSpecterApp`. Everything else here is per Event Log and Layer.
 */
export function makeSpecterRuntime<const TConfig extends SpecterAppConfig>(
  config: TConfig | PreparedSpecterApp<TConfig>,
): Effect.Effect<
  SpecterEffectApp<TConfig>,
  SpecterEffectError,
  SpecterRuntimeRequirements<TConfig> | import('effect').Scope.Scope
> {
  return Effect.gen(function* () {
    const {
      slices,
      eagerSlices,
      eventDefinitions,
      commands,
      queries,
      reactions,
      applyBySlice,
      allowedCommandEvents,
    } = yield* resolvePlan(config)

    const eventLog = yield* EventLog
    const scheduler = yield* ReactionScheduler
    const scope = yield* Effect.scope
    const services = yield* Effect.context<
      SpecterStoreRequirements<TConfig> | SpecterPluginRequirements<TConfig>
    >()
    const stores = new Map<SliceRegistration, ResolvedStore>()
    const reactionExecs = new Map<string, ReactionExec>()
    const reactionSkips = new Map<string, ReactionSkip>()
    const subscriptions = new Set<Subscription>()

    for (const slice of slices) {
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

    // Registered before the scheduler binds, so it runs after Reaction work
    // stops: a graceful shutdown leaves no skipped tail to re-read.
    yield* Effect.addFinalizer(() =>
      Effect.forEach(
        [...reactionSkips],
        ([name, skip]) => {
          const reaction = reactions.get(name)
          return reaction
            ? flushReactionCursor(reaction, skip.from, skip.through).pipe(
                Effect.ignore,
              )
            : Effect.void
        },
        { discard: true },
      ),
    )

    const reactionScheduler =
      reactions.size === 0
        ? undefined
        : yield* scheduler.bind({
            execute: runReactions,
          })

    if (reactionScheduler) {
      const currentVersion = yield* eventLog.currentVersion
      const completion = yield* reactionScheduler.schedule(currentVersion)
      yield* completion
    }

    for (const slice of eagerSlices) {
      yield* catchUpSlice(slice)
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
      const knownCommand = commands.get(envelope.type)
      return Effect.gen(function* () {
        const result = yield* Effect.result(
          Effect.gen(function* () {
            const optionError = validateCommandOptions(options)
            if (optionError) return yield* Effect.fail(optionError)
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
            const scheduled = reactionScheduler
              ? yield* Effect.result(reactionScheduler.schedule(commit.version))
              : undefined
            const completion =
              scheduled?._tag === 'Failure'
                ? Effect.fail(scheduled.failure)
                : (scheduled?.success ?? Effect.void)
            const reactionFiber = yield* Effect.forkIn(completion, scope)
            return { command, commit, reactionFiber }
          }),
        )
        if (result._tag === 'Failure') {
          yield* Effect.annotateCurrentSpan({
            'specter.outcome': isCommandRejection(result.failure)
              ? 'rejected'
              : 'failed',
            ...safeErrorAttributes(result.failure),
          })
          return yield* Effect.fail(result.failure)
        }
        const { commit, reactionFiber } = result.success
        yield* Effect.annotateCurrentSpan({
          'specter.outcome': 'accepted',
          'specter.event.count': commit.events.length,
          'specter.event.types': commit.events.map((event) => event.type),
          'specter.event.orders': commit.events.map((event) => event.order),
          'specter.event_log.version': commit.version,
          'specter.command.duplicate': commit.duplicate,
        })

        return {
          events: commit.events,
          version: commit.version,
          duplicate: commit.duplicate,
          reactions: Fiber.join(reactionFiber),
        }
      }).pipe(
        withSafeSpan(`specter.command ${envelope.type}`, {
          attributes: sliceSpanAttributes(
            'command',
            envelope.type,
            knownCommand,
          ),
        }),
      )
    }

    function dispatchQuery(
      envelope: CommandEnvelope,
    ): Effect.Effect<unknown, SpecterEffectError> {
      return runObservedQuery(envelope, false)
    }

    function dispatchSubscription(
      envelope: CommandEnvelope,
    ): Stream.Stream<unknown, SpecterEffectError> {
      const query = queries.get(envelope.type)
      if (!query) return Stream.fromEffect(runObservedQuery(envelope, true))

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
        Stream.mapEffect(() => runObservedQuery(envelope, true)),
      )
    }

    function runObservedQuery(
      envelope: CommandEnvelope,
      subscription: boolean,
    ): Effect.Effect<unknown, SpecterEffectError> {
      const knownQuery = queries.get(envelope.type)
      return Effect.gen(function* () {
        const result = yield* Effect.result(
          Effect.gen(function* () {
            const query = queries.get(envelope.type)
            if (!query) {
              return yield* Effect.fail(
                new SpecterUnknownQueryError(envelope.type),
              )
            }
            return yield* runQuery(query, envelope.payload)
          }),
        )
        if (result._tag === 'Failure') {
          yield* Effect.annotateCurrentSpan({
            'specter.outcome': isQueryRejection(result.failure)
              ? 'rejected'
              : 'failed',
            ...safeErrorAttributes(result.failure),
          })
          return yield* Effect.fail(result.failure)
        }
        yield* Effect.annotateCurrentSpan('specter.outcome', 'completed')
        return result.success
      }).pipe(
        withSafeSpan(`specter.query ${envelope.type}`, {
          attributes: {
            ...sliceSpanAttributes('query', envelope.type, knownQuery),
            'specter.query.subscription': subscription,
          },
        }),
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
      return Effect.gen(function* () {
        const result = yield* Effect.result(
          resolved.service
            .transaction(slice.name, (write, _read, cursor, publishCursor) =>
              Effect.gen(function* () {
                const handlers = applyBySlice.get(slice)
                const eventTypes = [...(handlers?.keys() ?? [])]
                if (eventTypes.length === 0) return undefined
                const loaded = yield* eventLog.query(cursor, eventTypes)
                const events =
                  throughOrder === undefined
                    ? loaded
                    : loaded.filter((event) => event.order <= throughOrder)
                assertEventLogOrder(cursor, events)
                if (events.length === 0) return undefined
                for (const event of yield* Effect.forEach(
                  events,
                  decodePersistedEvent,
                )) {
                  const apply = handlers?.get(event.type)
                  if (!apply) continue
                  yield* fromPromise(
                    () => apply.handle(event, write),
                    (cause) =>
                      new SpecterProjectionFailedError(slice.name, cause),
                  )
                }
                const toOrder = events[events.length - 1].order
                yield* publishCursor(toOrder)
                return { fromOrder: cursor, toOrder, events }
              }),
            )
            .pipe(
              Effect.mapError((cause) =>
                isPublicError(cause)
                  ? cause
                  : new SpecterStoreFailureError(
                      slice.name,
                      'transaction',
                      cause,
                    ),
              ),
            ),
        )
        if (result._tag === 'Failure') {
          yield* Effect.annotateCurrentSpan({
            'specter.outcome': 'failed',
            ...safeErrorAttributes(result.failure),
          })
          return yield* Effect.fail(result.failure)
        }
        const caughtUp = result.success
        yield* Effect.annotateCurrentSpan({
          'specter.outcome': 'completed',
          'specter.event.count': caughtUp?.events.length ?? 0,
          ...(caughtUp
            ? {
                'specter.cursor.from': caughtUp.fromOrder,
                'specter.cursor.to': caughtUp.toOrder,
                'specter.event.types': caughtUp.events.map(
                  (event) => event.type,
                ),
                'specter.event.orders': caughtUp.events.map(
                  (event) => event.order,
                ),
              }
            : {}),
        })
      }).pipe(
        withSafeSpan(`specter.slice.catch-up ${slice.name}`, {
          attributes: sliceSpanAttributes(slice.kind, slice.name, slice),
        }),
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
        const handlers = applyBySlice.get(reaction)
        const cursor = yield* readStore(reaction, (_read, current) =>
          Effect.succeed(current),
        )
        // A remembered skip range applies only while the durable cursor sits
        // inside it; any other cursor means the Store moved independently.
        const remembered = reactionSkips.get(reaction.name)
        let scanned =
          remembered && remembered.from <= cursor && cursor < remembered.through
            ? remembered.through
            : cursor
        // Every commit in (skippedFrom, scanned] is irrelevant.
        let skippedFrom = cursor
        if (scanned < throughOrder) {
          const commits = yield* eventLog.commitsAfter(scanned)
          for (const commit of commits) {
            if (commit.version > throughOrder) break
            if (!commit.events.some((event) => handlers?.has(event.type))) {
              scanned = commit.version
              if (scanned - skippedFrom >= reactionSkipFlushOrders) {
                yield* flushReactionCursor(reaction, skippedFrom, scanned)
                skippedFrom = scanned
              }
              continue
            }
            rememberReactionSkip(reaction, skippedFrom, scanned)
            yield* runReactionCommit(reaction, commit)
            skippedFrom = commit.version
            scanned = commit.version
          }
        }
        rememberReactionSkip(reaction, skippedFrom, scanned)
        if (scanned - skippedFrom >= reactionSkipFlushOrders) {
          yield* flushReactionCursor(reaction, skippedFrom, scanned)
        }
      })
    }

    function rememberReactionSkip(
      reaction: AnyReaction,
      from: number,
      through: number,
    ) {
      if (through > from) reactionSkips.set(reaction.name, { from, through })
    }

    function flushReactionCursor(
      reaction: AnyReaction,
      from: number,
      through: number,
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
        const result = yield* Effect.result(
          resolved.service
            .transaction(
              reaction.name,
              (_write, _read, cursor, publishCursor) =>
                // Publish only across the skipped range: never backwards,
                // and never from a cursor older than that range.
                cursor < from || cursor >= through
                  ? Effect.succeed(undefined)
                  : publishCursor(through).pipe(Effect.as(cursor)),
            )
            .pipe(
              Effect.mapError((cause) =>
                isPublicError(cause)
                  ? cause
                  : new SpecterStoreFailureError(
                      reaction.name,
                      'transaction',
                      cause,
                    ),
              ),
            ),
        )
        if (result._tag === 'Failure') {
          yield* Effect.annotateCurrentSpan({
            'specter.outcome': 'failed',
            ...safeErrorAttributes(result.failure),
          })
          return yield* Effect.fail(result.failure)
        }
        const fromOrder = result.success
        yield* Effect.annotateCurrentSpan({
          'specter.outcome': fromOrder === undefined ? 'skipped' : 'completed',
          ...(fromOrder === undefined
            ? {}
            : {
                'specter.cursor.from': fromOrder,
                'specter.cursor.to': through,
              }),
        })
      }).pipe(
        withSafeSpan(`specter.reaction.cursor ${reaction.name}`, {
          attributes: sliceSpanAttributes('reaction', reaction.name, reaction),
        }),
      )
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
      const deliveryId = `${reaction.name}:${commit.version}`
      return Effect.gen(function* () {
        const result = yield* Effect.result(
          resolved.service
            .transaction(reaction.name, (write, read, cursor, publishCursor) =>
              Effect.gen(function* () {
                if (cursor >= commit.version) return false
                const execute = yield* getReactionExec(reaction)
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
                  const handled = yield* fromPromise(
                    () => reaction.handle(read()),
                    (cause) =>
                      new SpecterInfrastructureError(
                        `Reaction "${reaction.name}" handler failed.`,
                        cause,
                      ),
                  )
                  if (handled !== undefined) {
                    const output = yield* fromPromise(
                      () =>
                        decodeOptionalSchema(reaction.outputSchema, handled),
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
                      Effect.provideService(DirectReactionExecution, true),
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
                return true
              }),
            )
            .pipe(
              Effect.mapError((cause) =>
                isPublicError(cause)
                  ? cause
                  : new SpecterStoreFailureError(
                      reaction.name,
                      'transaction',
                      cause,
                    ),
              ),
            ),
        )
        if (result._tag === 'Failure') {
          yield* Effect.annotateCurrentSpan({
            'specter.outcome': 'failed',
            ...safeErrorAttributes(result.failure),
          })
          return yield* Effect.fail(result.failure)
        }
        yield* Effect.annotateCurrentSpan({
          'specter.outcome': result.success ? 'completed' : 'skipped',
          'specter.reaction.duplicate': !result.success,
        })
      }).pipe(
        withSafeSpan(`specter.reaction ${reaction.name}`, {
          attributes: {
            ...sliceSpanAttributes('reaction', reaction.name, reaction),
            'specter.reaction.delivery_id': deliveryId,
            'specter.event_log.commit_version': commit.version,
            'specter.event.count': commit.events.length,
            'specter.event.types': commit.events.map((event) => event.type),
            'specter.event.orders': commit.events.map((event) => event.order),
          },
        }),
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
      ): Effect.Effect<CommandReceipt, SpecterEffectError> =>
        dispatchCommand(envelope, options).pipe(
          Effect.map(({ events, version, duplicate }) => ({
            events,
            version,
            duplicate,
          })),
        )
      const query: QueryDispatch = (slice, input) =>
        Effect.gen(function* () {
          const registered = queries.get(slice.name)
          if (!registered) {
            return yield* Effect.fail(new SpecterUnknownQueryError(slice.name))
          }
          if (registered !== slice) {
            return yield* Effect.fail(
              new SpecterInfrastructureError(
                `Reaction "${reaction.name}" Plugin queried "${slice.name}" with a Query Slice that is not the one registered in this app. Pass the registered Query Slice value.`,
                undefined,
              ),
            )
          }
          if (yield* DirectReactionExecution) {
            return yield* Effect.fail(
              new SpecterPluginQueryInTransactionError(
                reaction.name,
                slice.name,
              ),
            )
          }
          return yield* dispatchQuery({ type: slice.name, payload: input })
        }) as Effect.Effect<never, SpecterEffectError>
      const pluginContext: ReactionPluginContext = Object.freeze({
        command,
        query,
      })
      const plugin: ReactionPlugin<unknown, unknown> =
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
                ).pipe(Effect.asVoid)
              : Effect.fail(
                  new SpecterInfrastructureError(
                    `Reaction "${reaction.name}" uses default Command Plugin but returned a non-Command envelope.`,
                    output,
                  ),
                ),
          ))
      return plugin(pluginContext).pipe(
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
          const eventTypes = [...(handlers?.keys() ?? [])].filter((type) =>
            changed.has(type),
          )
          if (eventTypes.length === 0) continue
          Queue.offerUnsafe(subscription.queue, undefined)
        }
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
  config: TConfig | PreparedSpecterApp<TConfig>,
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

/**
 * Sole Promise bridge, intended only for HTTP/WebSocket transport edges.
 *
 * Synchronous: runtime startup (validation for a raw config, then Store
 * resolution and catch-up) begins immediately and its failure rejects every
 * later operation. `createSpecterApp` awaits that startup instead.
 */
export function createSpecterPromiseApp<const TConfig extends SpecterAppConfig>(
  config: TConfig | PreparedSpecterApp<TConfig>,
  dependencies: Layer.Layer<SpecterRuntimeRequirements<TConfig>>,
): SpecterApp<TConfig> {
  return startSpecterPromiseApp(config, dependencies).app
}

/** Internal: the Promise app plus a Promise that settles with its startup. */
export function startSpecterPromiseApp<const TConfig extends SpecterAppConfig>(
  config: TConfig | PreparedSpecterApp<TConfig>,
  dependencies: Layer.Layer<SpecterRuntimeRequirements<TConfig>>,
): { readonly app: SpecterApp<TConfig>; readonly ready: Promise<unknown> } {
  const runtime = ManagedRuntime.make(
    createSpecterAppLayer(config).pipe(Layer.provideMerge(dependencies)),
  )
  const service = runtime.runPromise(Effect.service(SpecterRuntime))
  // Startup failure is reported by each operation that awaits `service`; an
  // app nobody calls must not crash the process with an unhandled rejection.
  void service.catch(() => undefined)
  let closed = false
  const app = Object.freeze({
    command: async (command, options) => {
      const execution = await runtime.runPromise(
        (await service).command(command, options),
      )
      const reactions = runtime.runPromise(execution.reactions)
      void reactions.catch(() => undefined)
      return {
        ...execution,
        reactions,
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
  return { app, ready: service }
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

function sliceSpanAttributes(
  kind: SliceRegistration['kind'],
  name: string,
  slice: SliceRegistration | undefined,
): Record<string, unknown> {
  return {
    'specter.slice.name': slice?.name ?? name,
    'specter.slice.kind': kind,
    ...(slice ? { 'specter.spec.digest': slice.specificationDigest } : {}),
  }
}

const safeSpecterErrorMessages: Readonly<Record<string, string>> = {
  [specterErrorCodes.commandRejected]: 'Command was rejected.',
  [specterErrorCodes.conformanceFailed]: 'Runtime conformance failed.',
  [specterErrorCodes.eventLogOrderViolation]: 'Event Log ordering is invalid.',
  [specterErrorCodes.idempotencyConflict]:
    'The idempotency key conflicts with an earlier Command.',
  [specterErrorCodes.infrastructureFailure]: 'Runtime operation failed.',
  [specterErrorCodes.invalidCommandOptions]: 'Command options are invalid.',
  [specterErrorCodes.invalidInput]: 'Operation input is invalid.',
  [specterErrorCodes.invalidOutput]: 'Operation output is invalid.',
  [specterErrorCodes.pluginQueryInTransaction]:
    'Reaction Plugin queried inside its Slice transaction.',
  [specterErrorCodes.projectionFailed]: 'Slice projection failed.',
  [specterErrorCodes.reactionFailure]: 'One or more Reactions failed.',
  [specterErrorCodes.storeConfiguration]: 'Slice Store is not configured.',
  [specterErrorCodes.storeFailure]: 'Slice Store operation failed.',
  [specterErrorCodes.unknownCommand]: 'Command type is not registered.',
  [specterErrorCodes.unknownEvent]: 'Event type is not registered.',
  [specterErrorCodes.unknownQuery]: 'Query type is not registered.',
  [specterErrorCodes.versionConflict]: 'Event Log version conflict.',
}

function safeErrorAttributes(cause: unknown): Record<string, unknown> {
  const candidate =
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    typeof cause.code === 'string'
      ? cause.code
      : specterErrorCodes.infrastructureFailure
  const code =
    candidate in safeSpecterErrorMessages
      ? candidate
      : specterErrorCodes.infrastructureFailure
  return {
    'specter.error.code': code,
    'specter.error.message': safeSpecterErrorMessages[code],
  }
}

/**
 * Effect ends failed spans with the full failure Cause. OTLP exporters turn
 * that Cause into status text and exception events, so ending with the public
 * runtime error would leak handler or payload details. End the span with a new
 * safe error, then return the original Exit to the caller.
 */
function withSafeSpan(
  name: string,
  options: {
    readonly attributes?: Record<string, unknown>
  },
) {
  return <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.useSpan(name, options, (span) =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(Effect.withParentSpan(effect, span))
        if (Exit.isFailure(exit)) {
          const failed = exit.cause.reasons.find(Cause.isFailReason)
          const attributes = safeErrorAttributes(failed?.error)
          const safeError = new Error(
            String(attributes['specter.error.message']),
          )
          safeError.name = 'SpecterSpanError'
          yield* Effect.clockWith((clock) =>
            Effect.sync(() =>
              span.end(clock.currentTimeNanosUnsafe(), Exit.fail(safeError)),
            ),
          )
        }
        return yield* exit
      }),
    )
}

function isCommandRejection(cause: SpecterEffectError) {
  return (
    cause instanceof SpecterCommandRejectedError ||
    cause instanceof SpecterUnknownCommandError ||
    cause instanceof SpecterInvalidCommandOptionsError ||
    (cause instanceof SpecterInvalidInputError &&
      cause.operationKind === 'command') ||
    cause instanceof SpecterVersionConflictError ||
    cause instanceof SpecterIdempotencyConflictError
  )
}

function isQueryRejection(cause: SpecterEffectError) {
  return (
    cause instanceof SpecterUnknownQueryError ||
    (cause instanceof SpecterInvalidInputError &&
      cause.operationKind === 'query')
  )
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
