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
  const events: PersistedEvent[] = []
  // Each Event's stored keys, by order, and the orders carrying each key.
  const keysByOrder = new Map<number, Readonly<Record<string, string>>>()
  const ordersByKey = new Map<string, number[]>()
  const commits: EventLogCommit[] = []
  const commitsByIdempotencyKey = new Map<string, EventLogCommit>()
  const copyEvent = (event: PersistedEvent): PersistedEvent => ({ ...event })
  // Whether a stored Event is one the condition's decision read.
  const read = (event: PersistedEvent, condition: EventLogAppendCondition) => {
    if (!condition.eventTypes.includes(event.type)) return false
    if (!condition.keys) return true
    const carried = keysByOrder.get(event.order) ?? {}
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

  return {
    capabilities: { scopedAppend: true, keyedRead: true },
    query: (afterOrder, eventTypes) =>
      Effect.sync(() =>
        events
          .filter(
            (event) =>
              event.order > afterOrder && eventTypes.includes(event.type),
          )
          .map(copyEvent),
      ),
    currentVersion: Effect.sync(() => events.at(-1)?.order ?? 0),
    readKey: (key, page = {}) =>
      Effect.sync(() => {
        const afterOrder = page.afterOrder ?? 0
        const orders = (ordersByKey.get(keyOf(key.name, key.value)) ?? [])
          .filter((order) => order > afterOrder)
          .slice(0, page.limit ?? Number.POSITIVE_INFINITY)
        return orders.map((order) =>
          copyEvent(events[order - 1] as PersistedEvent),
        )
      }),
    commitsAfter: (afterVersion) =>
      Effect.sync(() =>
        commits
          .filter((commit) => commit.version > afterVersion)
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
          const version = events.at(-1)?.order ?? 0
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
          if (unchanged) {
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
          }
          const persisted = drafts.map((draft, index): PersistedEvent => {
            const order = version + index + 1
            const time = recordedAt(order, draft)
            if (Number.isNaN(Date.parse(time))) {
              throw new Error('Event recordedAt must be an ISO-8601 timestamp')
            }
            return {
              type: draft.type,
              payload: draft.payload,
              id: eventId(order, draft),
              order,
              recordedAt: time,
            }
          })
          events.push(...persisted)
          for (const [index, draft] of drafts.entries()) {
            const order = version + index + 1
            keysByOrder.set(order, { ...draft.keys })
            for (const [name, value] of Object.entries(draft.keys)) {
              const key = keyOf(name, value)
              ordersByKey.set(key, [...(ordersByKey.get(key) ?? []), order])
            }
          }
          const commit: EventLogCommit = {
            events: persisted,
            version: persisted.at(-1)?.order ?? version,
            committedAt:
              persisted.at(-1)?.recordedAt ?? new Date().toISOString(),
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
    inspect: () => events.map(copyEvent),
    reset: () => {
      events.length = 0
      keysByOrder.clear()
      ordersByKey.clear()
      commits.length = 0
      commitsByIdempotencyKey.clear()
    },
  }
}

// Names cannot contain a NUL, so a name and value join unambiguously.
const keyOf = (name: string, value: string) => `${name}\u0000${value}`

export function createMemoryEventLogLayer(
  options: MemoryEventLogOptions = {},
): Layer.Layer<EventLog> {
  return Layer.sync(EventLog, () => createMemoryEventLog(options))
}
