import {
  Context,
  Effect,
  Layer,
  ManagedRuntime,
  Option,
  Queue,
  Stream,
} from 'effect'

import type {
  EventLogAppendResult,
  EventLogTransaction,
  ReactionDeliveryContext,
  SliceStoreService,
  SliceStoreTag,
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
  type ReactionExec,
  type SliceRegistration,
  valuesEqual,
  SpecterConformanceError,
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
  SpecterInvalidInputError,
  SpecterInvalidOutputError,
  SpecterProjectionFailedError,
  SpecterStoreConfigurationError,
  SpecterUnknownCommandError,
  SpecterUnknownEventError,
  SpecterUnknownQueryError,
  SpecterVersionConflictError,
} from '../runtime/errors'

export type SpecterEffectError =
  | SpecterError
  | SpecterConformanceError
  | ReactionRunFailure

type StoreOf<TSlice> = TSlice extends { readonly store: infer TStore }
  ? TStore
  : never

type StoreRequirement<TStore> = TStore extends SliceStoreTag<
  infer TIdentifier,
  SliceStoreService<any, any, any>
>
  ? TIdentifier
  : never

export type SpecterStoreRequirements<TConfig extends SpecterAppConfig> =
  StoreRequirement<StoreOf<TConfig['slices'][number]>>

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

export const SpecterRuntime = Context.Service<SpecterRuntimeService>(
  '@specter-ts/core/SpecterRuntime',
)

type ResolvedStore = {
  readonly service: SliceStoreService<unknown, unknown, unknown>
}

type Subscription = {
  readonly query: QuerySlice
  readonly input: unknown
  readonly queue: Queue.Queue<void, any>
}

type CommandCommit = EventLogAppendResult
type AnyCommand = Extract<SliceRegistration, { readonly kind: 'command' }>
type AnyQuery = Extract<SliceRegistration, { readonly kind: 'query' }>
type AnyReaction = Extract<SliceRegistration, { readonly kind: 'reaction' }>

/**
 * Builds Specter's native Effect interpreter. Slice callbacks remain ordinary
 * async functions; all lifecycle, dependency resolution, errors, and streams
 * are owned by Effect.
 */
export function makeSpecterRuntime<const TConfig extends SpecterAppConfig>(
  config: TConfig,
): Effect.Effect<
  SpecterEffectApp<TConfig>,
  SpecterEffectError,
  SpecterStoreRequirements<TConfig> | import('effect').Scope.Scope
> {
  return Effect.gen(function* () {
    yield* assertConforms(config)

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
    const pendingInvalidationEventTypes = new Set<string>()

    for (const eventDefinition of config.events) {
      eventDefinitions.set(eventDefinition.type, eventDefinition)
    }

    for (const slice of config.slices) {
      switch (slice.kind) {
        case 'command':
          commands.set(slice.name, slice)
          allowedCommandEvents.set(slice, commandScenarioEventTypes(slice))
          break
        case 'query':
          queries.set(slice.name, slice)
          break
        case 'reaction':
          reactions.set(slice.name, slice)
          break
      }

      applyBySlice.set(
        slice,
        new Map(slice.apply.map((apply) => [apply.event.type, apply] as const)),
      )
      stores.set(slice, yield* resolveStore(slice, services))
    }

    const runtime = makeRuntimeService()
    const requestReactions = config.schedule((context) =>
      Effect.runPromise(runReactions(context)),
    )

    yield* Effect.addFinalizer(() =>
      fromPromise(
        async () => {
          subscriptions.clear()
          await config.dispose?.()
        },
        (cause) =>
          toInfrastructure('Specter runtime cleanup failed.', cause),
      ).pipe(Effect.orDie),
    )

    if (reactions.size > 0) {
      yield* requestReactionPass(
        'The startup Reaction recovery pass failed.',
      )
    }

    const warmup = new Set(
      'warmupSlices' in config && Array.isArray(config.warmupSlices)
        ? config.warmupSlices
        : [],
    )
    for (const slice of config.slices) {
      if (warmup.has(slice.name) && slice.kind !== 'reaction') {
        yield* catchUpSlice(slice)
      }
    }

    return runtime as SpecterEffectApp<TConfig>

    function makeRuntimeService(): SpecterRuntimeService {
      return Object.freeze({
        command: dispatchCommand,
        query: dispatchQuery,
        subscribe: dispatchSubscription,
      })
    }

    function dispatchCommand(
      envelope: CommandEnvelope,
      options: CommandExecutionOptions = {},
    ): Effect.Effect<SpecterEffectCommandExecution, SpecterEffectError> {
      return Effect.gen(function* () {
        const command = commands.get(envelope.type)
        if (!command) {
          return yield* Effect.fail(
            new SpecterUnknownCommandError(envelope.type),
          )
        }

        const parsedCommand = yield* decodeInput(
          'command',
          command.name,
          command.inputSchema,
          envelope.payload,
        )
        const fingerprint = options.idempotencyKey
          ? yield* fromPromise(
              () => fingerprintCommand(command.name, parsedCommand),
              (cause) =>
                toInfrastructure(
                  `Command "${command.name}" fingerprint failed.`,
                  cause,
                ),
            )
          : undefined
        const commit = yield* runCommand(command, parsedCommand, {
          ...options,
          fingerprint,
        })

        if (!commit.duplicate) {
          for (const event of commit.events) {
            pendingInvalidationEventTypes.add(event.type)
          }
          yield* invalidateSubscriptions()
        }

        return {
          events: commit.events,
          version: commit.version,
          duplicate: commit.duplicate,
          reactions: requestReactionPass(
            commit.duplicate
              ? 'The Reaction scheduler failed while catching up a duplicate Command.'
              : 'The Reaction scheduler failed after the Command was committed.',
          ),
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
      if (!query) {
        return Stream.fail(new SpecterUnknownQueryError(envelope.type))
      }

      const triggers = Stream.callback<void>((queue) =>
        Effect.gen(function* () {
          const subscription = { query, input: envelope.payload, queue }
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

      return triggers.pipe(Stream.mapEffect(() => runQuery(query, envelope.payload)))
    }

    function runCommand(
      command: AnyCommand,
      parsedCommand: unknown,
      options: CommandExecutionOptions & { readonly fingerprint?: string },
    ): Effect.Effect<CommandCommit, SpecterEffectError> {
      return Effect.gen(function* () {
        if (options.idempotencyKey) {
          const previous = yield* eventLogCall(
            `Command "${command.name}" idempotency lookup failed.`,
            () => config.eventLog.findCommit(options.idempotencyKey as string),
          )
          if (previous) {
            if (
              !previous.fingerprint ||
              previous.fingerprint !== options.fingerprint
            ) {
              return yield* Effect.fail(
                new SpecterIdempotencyConflictError(options.idempotencyKey),
              )
            }
            return { ...previous, duplicate: true }
          }
        }

        const version = yield* eventLogCall(
          `Command "${command.name}" version lookup failed.`,
          () => config.eventLog.currentVersion(),
        )
        if (
          options.expectedVersion !== undefined &&
          options.expectedVersion !== version
        ) {
          return yield* Effect.fail(
            new SpecterVersionConflictError(options.expectedVersion, version),
          )
        }

        const events = yield* withCaughtUpStore(command, async (read) => {
          try {
            return await command.handle(parsedCommand, read)
          } catch (cause) {
            if (cause instanceof SpecterCommandRejectedError) throw cause
            throw new SpecterCommandRejectedError(command.name, cause)
          }
        })

        if (events.length === 0) {
          return yield* Effect.fail(
            new SpecterCommandRejectedError(
              command.name,
              new Error('Command emitted no Events.'),
            ),
          )
        }

        const allowedEventTypes = allowedCommandEvents.get(command)
        for (const [index, event] of events.entries()) {
          if (!allowedEventTypes?.has(event.type)) {
            return yield* Effect.fail(
              toInfrastructure(
                `Command "${command.name}" emitted unauthorized Event "${event.type}" at index ${index}. Add that Event type to an accepted scenario outcome before the Command may emit it.`,
                undefined,
              ),
            )
          }
        }

        const decodedEvents = yield* Effect.forEach(events, decodeEventDraft)
        return yield* eventLogCall(
          `Command "${command.name}" failed while appending Events.`,
          () =>
            config.eventLog.append(decodedEvents, {
              expectedVersion: version,
              idempotencyKey: options.idempotencyKey,
              fingerprint: options.fingerprint,
            }),
        )
      })
    }

    function runQuery(
      query: AnyQuery,
      input: unknown,
    ): Effect.Effect<unknown, SpecterEffectError> {
      return Effect.gen(function* () {
        const parsedInput = yield* decodeInput(
          'query',
          query.name,
          query.inputSchema,
          input,
        )
        const result = yield* withCaughtUpStore(query, (read) =>
          query.handle(parsedInput, read),
        )
        return yield* fromPromise(
          () => decodeOptionalSchema(query.outputSchema, result),
          (cause) => new SpecterInvalidOutputError('query', query.name, cause),
        )
      })
    }

    function withCaughtUpStore<A>(
      slice: SliceRegistration,
      use: (read: unknown) => Promise<A>,
    ): Effect.Effect<A, SpecterEffectError> {
      const resolved = stores.get(slice)
      if (!resolved) {
        return Effect.fail(
          toInfrastructure(`Slice "${slice.name}" has no Store binding.`, undefined),
        )
      }

      return resolved.service.transaction(slice.name, async (
        write,
        read,
        cursor,
        publishCursor,
      ) => {
        await catchUpInTransaction(
          slice,
          write,
          cursor,
          publishCursor,
          config.eventLog,
        )
        return use(read())
      }) as Effect.Effect<A, SpecterEffectError>
    }

    function catchUpSlice(
      slice: SliceRegistration,
    ): Effect.Effect<void, SpecterEffectError> {
      return withCaughtUpStore(slice, async () => undefined)
    }

    async function catchUpInTransaction(
      slice: SliceRegistration,
      write: unknown,
      cursor: number,
      publishCursor: (order: number) => Promise<void>,
      eventLog: EventLogTransaction,
    ) {
      const handlers = applyBySlice.get(slice)
      const eventTypes = [...(handlers?.keys() ?? [])]
      if (eventTypes.length === 0) return

      const events = await loadDecodedEvents(cursor, eventTypes, eventLog)
      if (events.length === 0) return

      try {
        for (const event of events) {
          await handlers?.get(event.type)?.handle(event, write)
        }
      } catch (cause) {
        throw new SpecterProjectionFailedError(slice.name, cause)
      }
      await publishCursor(events[events.length - 1].order)
    }

    async function loadDecodedEvents(
      cursor: number,
      eventTypes: readonly string[],
      eventLog: EventLogTransaction,
    ): Promise<readonly PersistedEvent[]> {
      if (eventTypes.length === 0) return []
      const events = await eventLog.query(cursor, eventTypes)
      assertEventLogOrder(cursor, events)
      return Promise.all(
        events.map(async (event) => {
          const definition = eventDefinitions.get(event.type)
          if (!definition) throw new SpecterUnknownEventError(event.type)
          const payload = await definition.decode(event.payload)
          if (!valuesEqual(payload, event.payload)) {
            throw toInfrastructure(
              `Event schema transformed persisted payload for "${event.type}". Event payload validation must preserve data one-to-one.`,
              undefined,
            )
          }
          return { ...event, payload }
        }),
      )
    }

    function decodeEventDraft(
      event: EventDraft,
    ): Effect.Effect<EventDraft, SpecterEffectError> {
      const definition = eventDefinitions.get(event.type)
      if (!definition) return Effect.fail(new SpecterUnknownEventError(event.type))
      return fromPromise(
        async () => {
          const payload = await definition.decode(event.payload)
          if (!valuesEqual(payload, event.payload)) {
            throw toInfrastructure(
              `Event schema transformed payload for "${event.type}". Event payload validation must preserve data one-to-one.`,
              undefined,
            )
          }
          return { ...event, payload }
        },
        preservePublicError(
          `Event schema rejected payload for "${event.type}".`,
        ),
      )
    }

    function requestReactionPass(
      message: string,
    ): Effect.Effect<void, SpecterEffectError> {
      return fromPromise(
        async () => {
          const waitForIdle = requestReactions()
          await waitForIdle()
          await Effect.runPromise(invalidateSubscriptions())
        },
        preservePublicError(message),
      )
    }

    function runReactions(
      passContext: ReactionDeliveryContext,
    ): Effect.Effect<void, ReactionRunFailure> {
      return Effect.gen(function* () {
        const failures = yield* Effect.forEach(
          [...reactions.values()],
          (reaction) =>
            runReaction(reaction, passContext).pipe(
              Effect.match({
                onFailure: (cause) => ({
                  sliceName: reaction.name,
                  cause,
                }),
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

    function runReaction(
      reaction: AnyReaction,
      passContext: ReactionDeliveryContext,
    ): Effect.Effect<void, SpecterEffectError> {
      const resolved = stores.get(reaction)
      if (!resolved) {
        return Effect.fail(
          toInfrastructure(
            `Reaction "${reaction.name}" has no Store binding.`,
            undefined,
          ),
        )
      }

      const execute = async (
        read: unknown,
        toOrder: number,
        publishCursor: (order: number) => Promise<void>,
      ) => {
        const result = await reaction.handle(read)
        if (result !== undefined) {
          const output = await decodeOptionalSchema(reaction.outputSchema, result)
          const exec = await getReactionExec(reaction)
          await exec(
            output,
            reactionDeliveryContext(passContext, reaction.name, toOrder),
          )
        }
        await publishCursor(toOrder)
      }

      return resolved.service.transaction(reaction.name, async (
        write,
        read,
        cursor,
        publishCursor,
      ) => {
        const handlers = applyBySlice.get(reaction)
        const events = await loadDecodedEvents(
          cursor,
          [...(handlers?.keys() ?? [])],
          config.eventLog,
        )
        if (events.length === 0) return
        try {
          for (const event of events) {
            await handlers?.get(event.type)?.handle(event, write)
          }
        } catch (cause) {
          throw new SpecterProjectionFailedError(reaction.name, cause)
        }
        await execute(read(), events[events.length - 1].order, publishCursor)
      }) as Effect.Effect<void, SpecterEffectError>
    }

    function getReactionExec(
      reaction: AnyReaction,
    ): Promise<ReactionExec> {
      const cached = reactionExecs.get(reaction.name)
      if (cached) return Promise.resolve(cached)
      return reaction.plugin(async (command, options) => {
        const execution = await Effect.runPromise(
          dispatchCommand(command, options),
        )
        await Effect.runPromise(execution.reactions)
      }).then((exec) => {
        reactionExecs.set(reaction.name, exec)
        return exec
      })
    }

    function invalidateSubscriptions(): Effect.Effect<void> {
      if (pendingInvalidationEventTypes.size === 0) return Effect.void
      const changed = new Set(pendingInvalidationEventTypes)
      pendingInvalidationEventTypes.clear()
      return Effect.sync(() => {
        for (const subscription of subscriptions) {
          const handlers = applyBySlice.get(subscription.query)
          if (
            [...(handlers?.keys() ?? [])].some((type) => changed.has(type))
          ) {
            Queue.offerUnsafe(subscription.queue, undefined)
          }
        }
      })
    }
  })
}

/** Builds a scoped runtime service whose Store requirements remain in `R`. */
export function createSpecterAppLayer<const TConfig extends SpecterAppConfig>(
  config: TConfig,
): Layer.Layer<
  SpecterRuntimeService,
  SpecterEffectError,
  SpecterStoreRequirements<TConfig>
> {
  return Layer.effect(
    SpecterRuntime,
    makeSpecterRuntime(config) as Effect.Effect<
      SpecterRuntimeService,
      SpecterEffectError,
      SpecterStoreRequirements<TConfig> | import('effect').Scope.Scope
    >,
  )
}

/** Thin Promise edge for HTTP servers and existing imperative applications. */
export function createSpecterPromiseApp<const TConfig extends SpecterAppConfig>(
  config: TConfig,
  stores: Layer.Layer<SpecterStoreRequirements<TConfig>>,
): SpecterApp<TConfig> {
  const runtime = ManagedRuntime.make(
    createSpecterAppLayer(config).pipe(Layer.provide(stores)),
  )
  return Object.freeze({
    command: async (command, options) => {
      const service = await runtime.runPromise(Effect.service(SpecterRuntime))
      const execution = await runtime.runPromise(
        service.command(command, options),
      )
      return {
        ...execution,
        reactions: runtime.runPromise(execution.reactions),
      }
    },
    query: async (query) => {
      const service = await runtime.runPromise(Effect.service(SpecterRuntime))
      return runtime.runPromise(service.query(query)) as Promise<never>
    },
    subscribe: (query) => ({
      async *[Symbol.asyncIterator]() {
        const service = await runtime.runPromise(Effect.service(SpecterRuntime))
        const iterable = Stream.toAsyncIterable(service.subscribe(query))
        for await (const value of iterable) yield value as never
      },
    }),
    close: () => runtime.dispose(),
  }) as SpecterApp<TConfig>
}

function resolveStore(
  slice: SliceRegistration,
  services: Context.Context<any>,
): Effect.Effect<ResolvedStore, SpecterStoreConfigurationError> {
  if (isStoreTag(slice.store)) {
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
          `Store Layer "${slice.store.key}" for Slice "${slice.name}" does not implement SliceStoreService.read and SliceStoreService.transaction.`,
          slice.store.key,
        ),
      )
    }
    return Effect.succeed({ service: found.value })
  }
  return Effect.fail(
    new SpecterStoreConfigurationError(
      slice.name,
      `Slice "${slice.name}" Store binding is not an Effect Context.Tag.`,
    ),
  )
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
    typeof service !== 'object' ||
    service === null ||
    !('read' in service) ||
    typeof service.read !== 'function' ||
    !('transaction' in service) ||
    typeof service.transaction !== 'function'
  ) === false
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

function fromPromise<A, E>(
  run: () => PromiseLike<A>,
  mapError: (cause: unknown) => E,
): Effect.Effect<A, E> {
  return Effect.tryPromise({ try: run, catch: mapError })
}

function eventLogCall<A>(
  message: string,
  run: () => PromiseLike<A>,
): Effect.Effect<A, SpecterEffectError> {
  return fromPromise(run, preservePublicError(message))
}

function preservePublicError(message: string) {
  return (cause: unknown): SpecterEffectError =>
    cause instanceof SpecterError ||
    cause instanceof SpecterConformanceError ||
    cause instanceof ReactionRunFailure
      ? cause
      : toInfrastructure(message, cause)
}

function toInfrastructure(message: string, cause: unknown) {
  return new SpecterInfrastructureError(message, cause)
}

function assertEventLogOrder(
  afterOrder: number,
  events: readonly PersistedEvent[],
) {
  let previous = afterOrder
  for (const event of events) {
    if (!Number.isInteger(event.order) || event.order <= previous) {
      throw new SpecterEventLogOrderError(
        afterOrder,
        events.map(({ order }) => order),
      )
    }
    previous = event.order
  }
}

function reactionDeliveryContext(
  pass: ReactionDeliveryContext,
  reactionName: string,
  cursor: number,
): ReactionDeliveryContext {
  return {
    ...pass,
    deliveryId: `${pass.deliveryId}:${reactionName}:${cursor}`,
  }
}

async function fingerprintCommand(type: string, payload: unknown) {
  const canonical = canonicalize({ type, payload })
  const bytes = new TextEncoder().encode(canonical)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return `v2:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')}`
}

function canonicalize(value: unknown): string {
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
    case 'object':
      if (Array.isArray(value)) {
        return `[${value.map(canonicalize).join(',')}]`
      }
      if (Object.getPrototypeOf(value) !== Object.prototype) {
        throw new TypeError('Command payload values must be plain JSON objects.')
      }
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
        .join(',')}}`
    default:
      throw new TypeError(`Command payload contains unsupported ${typeof value}.`)
  }
}
