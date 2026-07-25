import type {
  FusedApplyRegistration,
  FusedCommandSlice,
  FusedEventDraft,
  FusedEventType,
  FusedQuerySlice,
  FusedSlice,
  FusedStore,
} from './fused-slices'

export class FusedCommandRejectedError extends Error {
  constructor(readonly reason: string) {
    super(reason)
    this.name = 'FusedCommandRejectedError'
  }
}

export type FusedCommandExecution = {
  readonly fromOrder: number
  readonly throughOrder: number
}

type ErasedCommand = FusedCommandSlice<string, unknown, unknown>
type ErasedQuery = FusedQuerySlice<string, unknown, unknown, unknown>
type Projector = {
  readonly store: FusedStore<unknown>
  readonly handle: FusedApplyRegistration<unknown>['handle']
}

export class FusedSyncRuntime {
  readonly #commands = new Map<string, ErasedCommand>()
  readonly #queries = new Map<string, ErasedQuery>()
  readonly #eventTypes = new Set<string>()
  readonly #projectors = new Map<string, Projector[]>()
  readonly #states = new Map<FusedStore<unknown>, unknown>()
  readonly #events: FusedEventDraft[] = []

  constructor(config: {
    readonly events: readonly FusedEventType[]
    readonly slices: Readonly<Record<string, FusedSlice>>
  }) {
    for (const event of config.events) {
      if (this.#eventTypes.has(event.type)) {
        throw new Error(`Duplicate fused Event type: ${event.type}`)
      }
      this.#eventTypes.add(event.type)
    }

    for (const [registrationName, slice] of Object.entries(config.slices)) {
      if (registrationName !== slice.name) {
        throw new Error(
          `Fused Slice registry key ${registrationName} does not match ${slice.name}.`,
        )
      }
      this.#assertApplyCoverage(slice)
      this.#stateFor(slice.store)
      this.#registerProjectors(slice)
      if (slice.kind === 'command') {
        this.#commands.set(slice.name, slice as ErasedCommand)
      } else {
        this.#queries.set(slice.name, slice as ErasedQuery)
      }
    }
  }

  get version(): number {
    return this.#events.length
  }

  inspectEvents(): readonly FusedEventDraft[] {
    return this.#events
  }

  eventsAfter(order: number): readonly FusedEventDraft[] {
    return this.#events.slice(order)
  }

  state<TState>(store: FusedStore<TState>): TState {
    return this.#stateFor(store)
  }

  command<TName extends string, TInput, TState>(
    slice: FusedCommandSlice<TName, TInput, TState>,
    input: TInput,
  ): FusedCommandExecution {
    const fromOrder = this.version + 1
    slice.handle(input, this.#stateFor(slice.store), {
      emit: (event) => this.#emit(event),
    })
    return {
      fromOrder,
      throughOrder: this.version,
    }
  }

  commandEnvelope(type: string, payload: unknown): FusedCommandExecution {
    const slice = this.#commands.get(type)
    if (!slice) throw new Error(`Unknown fused Command Slice: ${type}`)
    return this.command(slice, payload)
  }

  query<TName extends string, TInput, TOutput, TState>(
    slice: FusedQuerySlice<TName, TInput, TOutput, TState>,
    input: TInput,
  ): TOutput {
    return slice.handle(input, this.#stateFor(slice.store))
  }

  queryEnvelope(type: string, payload: unknown): unknown {
    const slice = this.#queries.get(type)
    if (!slice) throw new Error(`Unknown fused Query Slice: ${type}`)
    return this.query(slice, payload)
  }

  replay(events: readonly FusedEventDraft[]): void {
    for (const event of events) this.#emit(event)
  }

  reset(): void {
    this.#events.length = 0
    for (const store of this.#states.keys()) {
      this.#states.set(store, store.createState())
    }
  }

  clearEventLog(): void {
    this.#events.length = 0
  }

  #emit(event: FusedEventDraft): void {
    if (!this.#eventTypes.has(event.type)) {
      throw new Error(`Unknown fused Event type: ${event.type}`)
    }
    for (const projector of this.#projectors.get(event.type) ?? []) {
      projector.handle(event, this.#stateFor(projector.store))
    }
    this.#events.push(event)
  }

  #stateFor<TState>(store: FusedStore<TState>): TState {
    const erased = store as FusedStore<unknown>
    if (!this.#states.has(erased)) {
      this.#states.set(erased, store.createState())
    }
    return this.#states.get(erased) as TState
  }

  #registerProjectors(slice: FusedSlice): void {
    for (const registration of slice.apply) {
      const current = this.#projectors.get(registration.event.type) ?? []
      const duplicate = current.some(
        (projector) =>
          projector.store === slice.store &&
          projector.handle === registration.handle,
      )
      if (!duplicate) {
        current.push({
          store: slice.store as FusedStore<unknown>,
          handle:
            registration.handle as FusedApplyRegistration<unknown>['handle'],
        })
        this.#projectors.set(registration.event.type, current)
      }
    }
  }

  #assertApplyCoverage(slice: FusedSlice): void {
    const given = new Set(
      slice.scenarios.flatMap((scenario) =>
        scenario.given.map((event) => event.eventType),
      ),
    )
    const applied = new Set(
      slice.apply.map((registration) => registration.event.type),
    )
    const missing = [...given].filter((eventType) => !applied.has(eventType))
    const extra = [...applied].filter((eventType) => !given.has(eventType))
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        `Fused Slice ${slice.name} apply coverage mismatch. Missing: ${missing.join(', ') || 'none'}. Extra: ${extra.join(', ') || 'none'}.`,
      )
    }
  }
}
