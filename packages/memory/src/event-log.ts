import {
  SpecterIdempotencyConflictError,
  SpecterVersionConflictError,
  type EventDraft,
  type EventLogAdapter,
  type EventLogAppendOptions,
  type EventLogCommit,
  type EventLogTransaction,
  type PersistedEvent,
} from '@specter-ts/core'

export type MemoryEventLogOptions = {
  readonly eventId?: (order: number, draft: EventDraft) => string
  readonly recordedAt?: (order: number, draft: EventDraft) => string
}

export type MemoryEventLog = EventLogAdapter & {
  inspect(): readonly PersistedEvent[]
  reset(): void
}

type MemoryEventLogState = {
  events: PersistedEvent[]
  commits: Map<string, EventLogCommit>
}

export function createMemoryEventLog(
  options: MemoryEventLogOptions = {},
): MemoryEventLog {
  const eventId = options.eventId ?? ((order: number) => `event-${order}`)
  const recordedAt =
    options.recordedAt ?? ((order: number) => new Date(order - 1).toISOString())
  let state: MemoryEventLogState = { events: [], commits: new Map() }
  let transactionTail = Promise.resolve()

  const copyEvent = (event: PersistedEvent): PersistedEvent => ({ ...event })
  const cloneCommit = (commit: EventLogCommit): EventLogCommit => ({
    ...commit,
    events: commit.events.map(copyEvent),
  })

  const cloneState = (source: MemoryEventLogState): MemoryEventLogState => ({
    events: source.events.map(copyEvent),
    commits: new Map(
      [...source.commits].map(([key, commit]) => [key, cloneCommit(commit)]),
    ),
  })

  function createTransaction(
    working: MemoryEventLogState,
  ): EventLogTransaction {
    return {
      async query(afterOrder, eventTypes) {
        if (!eventTypes.length) return []
        return working.events
          .filter(
            (event) =>
              event.order > afterOrder && eventTypes.includes(event.type),
          )
          .map(copyEvent)
      },
      async currentVersion() {
        return working.events.at(-1)?.order ?? 0
      },
      async findCommit(idempotencyKey) {
        const commit = working.commits.get(idempotencyKey)
        return commit ? cloneCommit(commit) : undefined
      },
      async append(
        drafts: readonly EventDraft[],
        appendOptions: EventLogAppendOptions = {},
      ) {
        const existing = appendOptions.idempotencyKey
          ? working.commits.get(appendOptions.idempotencyKey)
          : undefined
        if (existing) {
          if (existing.fingerprint !== appendOptions.fingerprint) {
            throw new SpecterIdempotencyConflictError(
              appendOptions.idempotencyKey as string,
            )
          }
          return { ...cloneCommit(existing), duplicate: true }
        }
        if (drafts.length === 0) {
          throw new Error('Event Log append requires at least one Event')
        }

        const version = working.events.at(-1)?.order ?? 0
        if (
          appendOptions.expectedVersion !== undefined &&
          appendOptions.expectedVersion !== version
        ) {
          throw new SpecterVersionConflictError(
            appendOptions.expectedVersion,
            version,
          )
        }

        const existingIds = new Set(working.events.map((event) => event.id))
        const events = drafts.map((draft, index): PersistedEvent => {
          const order = version + index + 1
          const id = eventId(order, draft)
          if (existingIds.has(id)) {
            throw new Error(`Duplicate Event id: ${id}`)
          }
          existingIds.add(id)
          const recordedTime = recordedAt(order, draft)
          if (Number.isNaN(Date.parse(recordedTime))) {
            throw new Error('Event recordedAt must be an ISO-8601 timestamp')
          }
          return {
            ...draft,
            id,
            order,
            recordedAt: recordedTime,
          }
        })
        working.events.push(...events)
        const commit: EventLogCommit = {
          events,
          version: events.at(-1)?.order ?? version,
          idempotencyKey: appendOptions.idempotencyKey,
          fingerprint: appendOptions.fingerprint,
        }
        if (appendOptions.idempotencyKey) {
          working.commits.set(appendOptions.idempotencyKey, commit)
        }
        return { ...cloneCommit(commit), duplicate: false }
      },
    }
  }

  async function transaction<T>(
    run: (eventLog: EventLogTransaction) => Promise<T>,
  ) {
    const previous = transactionTail
    let release = () => {}
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.then(() => current)
    transactionTail = queued
    await previous

    try {
      const working = cloneState(state)
      const result = await run(createTransaction(working))
      state = working
      return result
    } finally {
      release()
      if (transactionTail === queued) transactionTail = Promise.resolve()
    }
  }

  const adapter: MemoryEventLog = {
    query(afterOrder, eventTypes) {
      return createTransaction(state).query(afterOrder, eventTypes)
    },
    currentVersion() {
      return createTransaction(state).currentVersion()
    },
    findCommit(idempotencyKey) {
      return createTransaction(state).findCommit(idempotencyKey)
    },
    append(drafts, appendOptions) {
      return transaction((eventLog) => eventLog.append(drafts, appendOptions))
    },
    transaction,
    inspect() {
      return state.events.map(copyEvent)
    },
    reset() {
      state = { events: [], commits: new Map() }
    },
  }

  return adapter
}
