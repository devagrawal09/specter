import type { EventDraft, PersistedEvent } from '../core/event'

export type SliceStore<TWriteState = unknown, TReadState = TWriteState> = {
  write: TWriteState
  read: TReadState
  lastAppliedOrder: () => Promise<number>
  setLastAppliedOrder: (order: number) => Promise<void>
}

export type SliceStoreAdapter<
  TWriteState = unknown,
  TReadState = TWriteState,
  _TRequirements = unknown,
> = {
  get: (sliceName: string) => SliceStore<TWriteState, TReadState>
  transaction: <T>(
    sliceName: string,
    run: (store: SliceStore<TWriteState, TReadState>) => Promise<T>,
  ) => Promise<T>
}

export type EventLogAdapter<_TRequirements = unknown> = {
  readAfter: (
    order: number,
    eventTypes: readonly string[],
  ) => Promise<PersistedEvent[]>
  append: (events: readonly EventDraft[]) => Promise<PersistedEvent[]>
  transaction: <T>(run: (eventLog: EventLogAdapter) => Promise<T>) => Promise<T>
}
