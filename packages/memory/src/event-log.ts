import {
  EventLog,
  EventLogFailure,
  SpecterVersionConflictError,
  type EventDraft,
  type EventLogAppendCondition,
  type EventLogCommit,
  type EventLogService,
  type PersistedEvent,
} from '@specter-ts/core'
import { Effect, Layer } from 'effect'

export type MemoryEventLogOptions = {
  readonly eventId?: (order: number, draft: EventDraft) => string
  readonly recordedAt?: (order: number, draft: EventDraft) => string
}

export type MemoryEventLog = EventLogService & {
  readonly inspect: () => readonly PersistedEvent[]
  readonly reset: () => void
}

export function createMemoryEventLog(
  options: MemoryEventLogOptions = {},
): MemoryEventLog {
  const eventId = options.eventId ?? ((order: number) => `event-${order}`)
  const recordedAt =
    options.recordedAt ?? ((order: number) => new Date(order - 1).toISOString())
  // The Events in order. A purge leaves gaps, so an Event is found by its
  // order in `byOrder`, never by its position.
  let events: PersistedEvent[] = []
  const byOrder = new Map<number, PersistedEvent>()
  // The highest order the log ever assigned, which a purge never lowers.
  let version = 0
  // The highest order a purge removed, by Event type.
  const purgedThrough = new Map<string, number>()
  // The IDs Events are stored under, and the orders carrying each key.
  const ids = new Set<string>()
  const ordersByKey = new Map<string, number[]>()
  let commits: EventLogCommit[] = []
  const commitsByIdempotencyKey = new Map<string, EventLogCommit>()
  const copyEvent = (event: PersistedEvent): PersistedEvent => ({
    ...event,
    keys: { ...event.keys },
  })
  // Whether a stored Event is one the condition's decision read.
  const read = (event: PersistedEvent, condition: EventLogAppendCondition) => {
    if (!condition.eventTypes.includes(event.type)) return false
    if (!condition.keys) return true
    const carried = event.keys
    return Object.entries(condition.keys).some(
      ([name, values]) =>
        Object.hasOwn(carried, name) &&
        values.includes(carried[name] as string),
    )
  }
  const copyCommit = (commit: EventLogCommit): EventLogCommit => ({
    ...commit,
    events: commit.events.map(copyEvent),
  })

  // Whether a purge removed an Event the condition's decision read after it
  // read: one of its types above `afterOrder`, whatever its keys.
  const purgedAfter = (condition: EventLogAppendCondition) =>
    condition.eventTypes.find(
      (type) => (purgedThrough.get(type) ?? 0) > condition.afterOrder,
    )

  return {
    capabilities: { scopedAppend: true, keyedRead: true, purge: true },
    query: (afterOrder, eventTypes, page = {}) =>
      Effect.sync(() =>
        events
          .filter(
            (event) =>
              event.order > afterOrder && eventTypes.includes(event.type),
          )
          .slice(0, page.limit)
          .map(copyEvent),
      ),
    currentVersion: Effect.sync(() => version),
    readKey: (key, page = {}) =>
      Effect.sync(() => {
        const afterOrder = page.afterOrder ?? 0
        const orders = (ordersByKey.get(keyOf(key.name, key.value)) ?? [])
          .filter((order) => order > afterOrder)
          .slice(0, page.limit ?? Number.POSITIVE_INFINITY)
        return orders.map((order) =>
          copyEvent(byOrder.get(order) as PersistedEvent),
        )
      }),
    commitsAfter: (afterVersion, page = {}) =>
      Effect.sync(() =>
        commits
          .filter((commit) => commit.version > afterVersion)
          .slice(0, page.limit)
          .map(copyCommit),
      ),
    findCommit: (key) =>
      Effect.sync(() => {
        const commit = commitsByIdempotencyKey.get(key)
        return commit ? copyCommit(commit) : undefined
      }),
    append: (drafts, appendOptions = {}) =>
      Effect.try({
        try: () => {
          const existing = appendOptions.idempotencyKey
            ? commitsByIdempotencyKey.get(appendOptions.idempotencyKey)
            : undefined
          if (existing) {
            return { ...copyCommit(existing), duplicate: true }
          }
          if (drafts.length === 0) {
            throw new Error('Event Log append requires at least one Event')
          }
          if (
            appendOptions.expectedVersion !== undefined &&
            appendOptions.expectedVersion !== version
          ) {
            throw new SpecterVersionConflictError(
              appendOptions.expectedVersion,
              version,
            )
          }
          const unchanged = appendOptions.expectedUnchanged
          if (unchanged && !matchesNothing(unchanged)) {
            for (let index = events.length - 1; index >= 0; index--) {
              const event = events[index] as PersistedEvent
              if (event.order <= unchanged.afterOrder) break
              if (read(event, unchanged)) {
                throw new SpecterVersionConflictError(
                  unchanged.afterOrder,
                  event.order,
                )
              }
            }
            const purged = purgedAfter(unchanged)
            if (purged !== undefined) {
              throw new SpecterVersionConflictError(
                unchanged.afterOrder,
                purgedThrough.get(purged) as number,
              )
            }
          }
          const appended = new Set<string>()
          const persisted = drafts.map((draft, index): PersistedEvent => {
            const order = version + index + 1
            // The host's ID and time when it supplied them.
            const id = draft.id ?? eventId(order, draft)
            const time = draft.recordedAt ?? recordedAt(order, draft)
            if (Number.isNaN(Date.parse(time))) {
              throw new Error('Event recordedAt must be an ISO-8601 timestamp')
            }
            if (ids.has(id) || appended.has(id)) {
              throw new Error(`Event ID "${id}" is in the log already`)
            }
            appended.add(id)
            return {
              type: draft.type,
              payload: draft.payload,
              id,
              order,
              recordedAt: time,
              keys: { ...draft.keys },
            }
          })
          events.push(...persisted)
          for (const event of persisted) {
            byOrder.set(event.order, event)
            ids.add(event.id)
            for (const [name, value] of Object.entries(event.keys)) {
              const key = keyOf(name, value)
              ordersByKey.set(key, [
                ...(ordersByKey.get(key) ?? []),
                event.order,
              ])
            }
          }
          const lastOrder = version + drafts.length
          version = lastOrder
          const commit: EventLogCommit = {
            events: persisted,
            version: lastOrder,
            // The log's own time, whatever time the host gave its Events.
            committedAt: recordedAt(
              lastOrder,
              drafts.at(-1) as (typeof drafts)[number],
            ),
            idempotencyKey: appendOptions.idempotencyKey,
            fingerprint: appendOptions.fingerprint,
          }
          commits.push(commit)
          if (appendOptions.idempotencyKey) {
            commitsByIdempotencyKey.set(appendOptions.idempotencyKey, commit)
          }
          return { ...copyCommit(commit), duplicate: false }
        },
        catch: (cause) => new EventLogFailure('append', cause),
      }),
    purge: (key, purgeOptions = {}) =>
      Effect.try({
        try: () => {
          const keep = new Set(purgeOptions.keep ?? [])
          const removed = new Set(
            (ordersByKey.get(keyOf(key.name, key.value)) ?? []).filter(
              (order) => !keep.has((byOrder.get(order) as PersistedEvent).type),
            ),
          )
          if (removed.size === 0) return { purged: 0 }
          for (const order of removed) {
            const event = byOrder.get(order) as PersistedEvent
            byOrder.delete(order)
            ids.delete(event.id)
            purgedThrough.set(
              event.type,
              Math.max(purgedThrough.get(event.type) ?? 0, order),
            )
            for (const [name, value] of Object.entries(event.keys)) {
              const indexed = keyOf(name, value)
              const left = (ordersByKey.get(indexed) ?? []).filter(
                (kept) => kept !== order,
              )
              if (left.length > 0) ordersByKey.set(indexed, left)
              else ordersByKey.delete(indexed)
            }
          }
          events = events.filter((event) => !removed.has(event.order))
          // A commit keeps the Events it has left; one left with none goes,
          // with its idempotency receipt.
          commits = commits.flatMap((commit) => {
            if (!commit.events.some((event) => removed.has(event.order))) {
              return [commit]
            }
            const left = commit.events.filter(
              (event) => !removed.has(event.order),
            )
            if (commit.idempotencyKey) {
              commitsByIdempotencyKey.delete(commit.idempotencyKey)
            }
            if (left.length === 0) return []
            const kept = { ...commit, events: left }
            if (kept.idempotencyKey) {
              commitsByIdempotencyKey.set(kept.idempotencyKey, kept)
            }
            return [kept]
          })
          return { purged: removed.size }
        },
        catch: (cause) => new EventLogFailure('purge', cause),
      }),
    inspect: () => events.map(copyEvent),
    reset: () => {
      events = []
      byOrder.clear()
      version = 0
      purgedThrough.clear()
      ids.clear()
      ordersByKey.clear()
      commits = []
      commitsByIdempotencyKey.clear()
    },
  }
}

/** A condition whose keys list no value: no Event matches it. */
const matchesNothing = (condition: EventLogAppendCondition) =>
  condition.keys !== undefined &&
  Object.values(condition.keys).every((values) => values.length === 0)

// Names cannot contain a NUL, so a name and value join unambiguously.
const keyOf = (name: string, value: string) => `${name}\u0000${value}`

export function createMemoryEventLogLayer(
  options: MemoryEventLogOptions = {},
): Layer.Layer<EventLog> {
  return Layer.sync(EventLog, () => createMemoryEventLog(options))
}
