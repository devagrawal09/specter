import type { EventLogAdapter, PersistedEvent } from '@specter-ts/core'

const resetters = new Set<() => void>()

export function createMemoryEventLog(): EventLogAdapter {
  let nextOrder = 1
  let events: PersistedEvent[] = []

  resetters.add(() => {
    nextOrder = 1
    events = []
  })

  const adapter: EventLogAdapter = {
    query: async (order, eventTypes) =>
      events.filter(
        (event) => event.order > order && eventTypes.includes(event.type),
      ),
    append: async (drafts) => {
      const persisted = drafts.map((event): PersistedEvent => {
        const order = nextOrder
        nextOrder += 1

        return {
          ...event,
          id: `event-${order}`,
          order,
          recordedAt: new Date(0),
        }
      })

      events = [...events, ...persisted]

      return persisted
    },
    transaction: async (run) => run(adapter),
  }

  return adapter
}

export const memoryEventLog = createMemoryEventLog()

export function resetMemoryEventLogs() {
  for (const reset of resetters) reset()
}
