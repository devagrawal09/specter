import type { Context, Effect } from 'effect'

/**
 * Runtime service contract supplied for a Slice's `.store(Context.Tag)`.
 *
 * The adapter owns projection persistence and concurrency. Specter only
 * requires that `transaction` publishes writes and its cursor atomically and
 * that visible cursors never move backwards. The adapter acquires exclusion
 * before invoking `run` and invokes it exactly once. Reaction Plugins may run
 * inside this transaction, so optimistic callback replay is forbidden.
 */
export type SliceStoreService<TRead, TWrite, TError = never> = {
  readonly read: <A, E, R>(
    sliceName: string,
    run: (state: TRead, cursor: number) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, TError | E, R>
  readonly transaction: <A, E, R>(
    sliceName: string,
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
