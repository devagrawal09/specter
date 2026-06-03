import type { EventDraft, PersistedEvent } from '../core/event'
import type { MaybePromise } from '../core/maybe-promise'

export type SliceStore<TWriteState = unknown, TReadState = TWriteState> = {
  write: TWriteState
  read: TReadState
  lastAppliedOrder: () => MaybePromise<number>
  setLastAppliedOrder: (order: number) => MaybePromise<void>
}

export type SliceStoreAdapter<
  TWriteState = unknown,
  TReadState = TWriteState,
> = {
  get: (sliceName: string) => SliceStore<TWriteState, TReadState>
  transaction: <T>(
    sliceName: string,
    run: (store: SliceStore<TWriteState, TReadState>) => MaybePromise<T>,
  ) => MaybePromise<T>
}

export type EventLogAdapter = {
  query: (
    order: number,
    eventTypes: readonly string[],
  ) => MaybePromise<PersistedEvent[]>
  append: (events: readonly EventDraft[]) => MaybePromise<PersistedEvent[]>
  transaction: <T>(
    run: (eventLog: EventLogAdapter) => MaybePromise<T>,
  ) => MaybePromise<T>
}
