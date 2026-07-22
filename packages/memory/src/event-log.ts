import {
  EventLog,
  EventLogFailure,
  SpecterIdempotencyConflictError,
  SpecterVersionConflictError,
  type EventDraft,
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
  const commits = new Map<string, EventLogCommit>()
  const copyEvent = (event: PersistedEvent): PersistedEvent => ({ ...event })
  const copyCommit = (commit: EventLogCommit): EventLogCommit => ({
    ...commit,
    events: commit.events.map(copyEvent),
  })

  return {
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
    findCommit: (key) =>
      Effect.sync(() => {
        const commit = commits.get(key)
        return commit ? copyCommit(commit) : undefined
      }),
    append: (drafts, appendOptions = {}) =>
      Effect.try({
        try: () => {
          const existing = appendOptions.idempotencyKey
            ? commits.get(appendOptions.idempotencyKey)
            : undefined
          if (existing) {
            if (existing.fingerprint !== appendOptions.fingerprint) {
              throw new SpecterIdempotencyConflictError(
                appendOptions.idempotencyKey as string,
              )
            }
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
          const persisted = drafts.map((draft, index): PersistedEvent => {
            const order = version + index + 1
            const time = recordedAt(order, draft)
            if (Number.isNaN(Date.parse(time))) {
              throw new Error('Event recordedAt must be an ISO-8601 timestamp')
            }
            return {
              ...draft,
              id: eventId(order, draft),
              order,
              recordedAt: time,
            }
          })
          events.push(...persisted)
          const commit: EventLogCommit = {
            events: persisted,
            version: persisted.at(-1)?.order ?? version,
            idempotencyKey: appendOptions.idempotencyKey,
            fingerprint: appendOptions.fingerprint,
          }
          if (appendOptions.idempotencyKey) {
            commits.set(appendOptions.idempotencyKey, commit)
          }
          return { ...copyCommit(commit), duplicate: false }
        },
        catch: (cause) => new EventLogFailure('append', cause),
      }),
    inspect: () => events.map(copyEvent),
    reset: () => {
      events.length = 0
      commits.clear()
    },
  }
}

export function createMemoryEventLogLayer(
  options: MemoryEventLogOptions = {},
): Layer.Layer<EventLog> {
  return Layer.sync(EventLog, () => createMemoryEventLog(options))
}
