export type SliceStore<
  TWriteState = unknown,
  TReadState = Readonly<TWriteState>,
> = {
  /** Mutable capability used only by Event apply handlers. */
  readonly write: TWriteState
  /** Read-only capability passed to Command, Query, and Reaction handlers. */
  readonly read: TReadState
  readonly lastAppliedOrder: () => Promise<number>
  /**
   * Atomically publishes the current staged write state with this cursor, or
   * uses an adapter-specific idempotent recovery guarantee. A failed apply
   * before this call must not expose partially advanced projection state.
   */
  readonly setLastAppliedOrder: (order: number) => Promise<void>
}

export type SliceStoreAdapter<
  TWriteState = unknown,
  TReadState = Readonly<TWriteState>,
> = {
  /** Returns an isolated staged projection view until its cursor is published. */
  readonly get: (
    sliceName: string,
  ) => Promise<SliceStore<TWriteState, TReadState>>
  /**
   * Locally commits explicitly grouped projection work. This boundary does
   * not make Slice State part of the authoritative Event Log transaction;
   * failed projections remain disposable and replayable.
   */
  readonly transaction: <T>(
    sliceName: string,
    run: (store: SliceStore<TWriteState, TReadState>) => Promise<T>,
  ) => Promise<T>
}

// Adapters may expose the same runtime object for `read` and `write`. Their
// separation is a type-level capability contract, not an allocation mandate.
