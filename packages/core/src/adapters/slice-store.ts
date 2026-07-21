import type { Effect } from 'effect'

/**
 * Runtime service contract supplied for a Slice's `.store(Context.Tag)`.
 *
 * The adapter owns projection persistence and concurrency. Specter only
 * requires that `transaction` publishes writes and its cursor atomically and
 * that visible cursors never move backwards. `run` may be retried by an
 * optimistic adapter, so apply handlers must remain free of external effects.
 */
export type SliceStoreService<
  TRead,
  TWrite,
  TError = never,
> = {
  readonly read: <A>(
    sliceName: string,
    run: (state: TRead, cursor: number) => Promise<A>,
  ) => Effect.Effect<A, TError>
  readonly transaction: <A>(
    sliceName: string,
    run: (
      write: TWrite,
      read: () => TRead,
      cursor: number,
      publishCursor: (order: number) => Promise<void>,
    ) => Promise<A>,
  ) => Effect.Effect<A, TError>
}

/** Minimal structural surface implemented by Effect `Context.Tag` values. */
export type SliceStoreTag<
  TIdentifier = unknown,
  TService extends SliceStoreService<unknown, unknown, unknown> =
    SliceStoreService<unknown, unknown, unknown>,
> = {
  readonly Service: TService
  readonly Identifier: TIdentifier
  readonly key: string
  readonly '~effect/Context/Service': '~effect/Context/Service'
}

export type SliceStoreRead<TStore> =
  TStore extends SliceStoreTag<unknown, SliceStoreService<infer TRead, any, any>>
    ? TRead
    : never

export type SliceStoreWrite<TStore> =
  TStore extends SliceStoreTag<unknown, SliceStoreService<any, infer TWrite, any>>
    ? TWrite
    : never

export type SliceStoreError<TStore> =
  TStore extends SliceStoreTag<unknown, SliceStoreService<any, any, infer TError>>
    ? TError
    : never

export type SliceStoreRequirement<TStore> =
  TStore extends SliceStoreTag<infer TIdentifier, any> ? TIdentifier : never
