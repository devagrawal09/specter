import { asc, eq, gt } from 'drizzle-orm'

import type { StoreTx } from '.'
import { events as eventTable } from '.'
import type { Event } from '../features/events'

export function readEventsAfter(order: number, tx: StoreTx): Event[] {
  return tx
    .select()
    .from(eventTable)
    .where(gt(eventTable.order, order))
    .orderBy(asc(eventTable.order))
    .all()
    .map((event) => ({
      id: event.id,
      type: event.type,
      payload: JSON.parse(event.payload),
      order: event.order,
    })) as unknown as Event[]
}

export function persistEvents(events: Event[], tx: StoreTx): Event[] {
  return events.map((event) => {
    tx.insert(eventTable)
      .values({
        id: event.id,
        type: event.type,
        payload: JSON.stringify(event.payload),
        createdAt: new Date(),
      })
      .run()

    const persistedEvent = tx
      .select({ order: eventTable.order })
      .from(eventTable)
      .where(eq(eventTable.id, event.id))
      .get()

    if (!persistedEvent) {
      throw new Error(`Event was not persisted: ${event.id}`)
    }

    return {
      ...event,
      order: persistedEvent.order,
    }
  }) as Event[]
}
