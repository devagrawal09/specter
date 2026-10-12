import type { Effect } from 'effect'

/**
 * One Slice's State as of its cursor, under the version of the Slice that
 * folded it (`SliceStoreSlice.version`). A process that starts from it
 * catches the Slice up after the cursor instead of folding the log from its
 * start; one whose Slice has another version ignores it.
 */
export type SliceSnapshot = {
  readonly slice: string
  readonly version: string
  readonly state: unknown
  readonly cursor: number
}

/**
 * Where a host keeps Slice snapshots between processes. Snapshots are a
 * cache of the Event Log: losing one only makes its Slice fold the log
 * again.
 */
export type SliceSnapshotStore = {
  /** The saved snapshots, one per Slice. */
  readonly load: Effect.Effect<readonly SliceSnapshot[], unknown>
  /**
   * Saves each snapshot in place of its Slice's saved one. A snapshot of the
   * same version never replaces one with a later cursor, so a Slice never
   * moves back; one of another version always replaces it.
   */
  readonly save: (
    snapshots: readonly SliceSnapshot[],
  ) => Effect.Effect<void, unknown>
}
