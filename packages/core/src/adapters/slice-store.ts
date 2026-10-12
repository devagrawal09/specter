import type { Context, Effect } from 'effect'

/**
 * The Slice a Store call is for. A Store keeps each Slice's State and cursor
 * under its `name`.
 */
export type SliceStoreSlice = {
  readonly name: string
  /**
   * The version of the Slice's State: it changes with the Slice's
   * specification digest and with the `stateVersion` its implementation
   * declares (`.store(Tag, { stateVersion })`), so a State of another shape
   * has another version. A Store keeps the version with the State and never
   * returns State kept under another version: it starts that Slice empty at
   * cursor 0, so the Slice folds the log from its start.
   */
  readonly version: string
}

/**
 * Runtime service contract supplied for a Slice's `.store(Context.Tag)`.
 *
 * The adapter owns projection persistence and concurrency. Specter only
 * requires that `transaction` publishes writes and its cursor atomically and
 * that visible cursors never move backwards. The adapter acquires exclusion
 * before invoking `run` and invokes it exactly once. Reaction Plugins may run
 * inside this transaction, so optimistic callback replay is forbidden.
 *
 * Beside each Slice's State and cursor, kept under its version, a Store keeps
 * under the Slice's name alone the highest cursor it has published for it
 * under any version (`reached`). A Reaction delivers each commit once, as its
 * cursor passes it; when its version changes, its State starts again at 0
 * but `reached` stays, so the runtime folds the new State up to `reached`
 * without delivering and delivers only the commits after it.
 */
export type SliceStoreService<TRead, TWrite, TError = never> = {
  readonly read: <A, E, R>(
    slice: SliceStoreSlice,
    run: (
      state: TRead,
      cursor: number,
      /**
       * The highest cursor published for the Slice's name under any
       * version: at least `cursor`, and never lower than before.
       */
      reached: number,
    ) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, TError | E, R>
  readonly transaction: <A, E, R>(
    slice: SliceStoreSlice,
    run: (
      write: TWrite,
      read: () => TRead,
      cursor: number,
      publishCursor: (order: number) => Effect.Effect<void, TError>,
    ) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, TError | E, R>
}

/** Minimal structural surface implemented by Effect `Context.Tag` values. */
export type SliceStoreTag<
  TIdentifier = unknown,
  TService extends SliceStoreService<
    unknown,
    unknown,
    unknown
  > = SliceStoreService<unknown, unknown, unknown>,
> = Context.Key<TIdentifier, TService>

export type SliceStoreRead<TStore> =
  TStore extends SliceStoreTag<
    unknown,
    SliceStoreService<infer TRead, infer _TWrite, infer _TError>
  >
    ? TRead
    : never

export type SliceStoreWrite<TStore> =
  TStore extends SliceStoreTag<
    unknown,
    SliceStoreService<infer _TRead, infer TWrite, infer _TError>
  >
    ? TWrite
    : never

export type SliceStoreError<TStore> =
  TStore extends SliceStoreTag<
    unknown,
    SliceStoreService<infer _TRead, infer _TWrite, infer TError>
  >
    ? TError
    : never

export type SliceStoreRequirement<TStore> =
  TStore extends SliceStoreTag<infer TIdentifier, infer _TService>
    ? TIdentifier
    : never
