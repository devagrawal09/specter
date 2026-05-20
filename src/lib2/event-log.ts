import { and, asc, eq, gt, inArray } from 'drizzle-orm'
import * as SqliteDrizzle from '@effect/sql-drizzle/Sqlite'
import { Data, Effect, Layer } from 'effect'

import { events as eventTable } from '../lib_legacy'
import type { Event, PersistedEvent } from './event'
import { EventLogService, type EventLogPort } from './services'

export class EventPayloadParseError extends Data.TaggedError(
  'EventPayloadParseError',
)<{
  readonly eventId: string
  readonly cause: unknown
}> {}

export class EventNotPersistedError extends Data.TaggedError(
  'EventNotPersistedError',
)<{
  readonly eventId: string
}> {}

export const EventLogLive = Layer.effect(
  EventLogService,
  Effect.gen(function* () {
    const db = yield* SqliteDrizzle.SqliteDrizzle

    return {
      readAfter: (order: number, eventTypes: readonly string[]) =>
        Effect.gen(function* () {
          if (eventTypes.length === 0) {
            return []
          }

          const rows = yield* db
            .select()
            .from(eventTable)
            .where(
              and(
                gt(eventTable.order, order),
                inArray(eventTable.type, [...eventTypes]),
              ),
            )
            .orderBy(asc(eventTable.order))

          return yield* Effect.forEach(rows, (event) =>
            Effect.gen(function* () {
              const payload = yield* Effect.try({
                try: () => JSON.parse(event.payload) as unknown,
                catch: (cause) =>
                  new EventPayloadParseError({ eventId: event.id, cause }),
              })

              return {
                id: event.id,
                type: event.type,
                payload,
                order: event.order,
              } as unknown as PersistedEvent
            }),
          )
        }),
      append: (events: readonly Event[]) =>
        Effect.gen(function* () {
          return yield* Effect.forEach(events, (event) =>
            Effect.gen(function* () {
              yield* db.insert(eventTable).values({
                id: event.id,
                type: event.type,
                payload: JSON.stringify(event.payload),
                createdAt: new Date(),
              })

              const rows = yield* db
                .select({ order: eventTable.order })
                .from(eventTable)
                .where(eq(eventTable.id, event.id))

              const persistedEvent = rows[0]

              if (!persistedEvent) {
                return yield* Effect.fail(
                  new EventNotPersistedError({ eventId: event.id }),
                )
              }

              return { ...event, order: persistedEvent.order }
            }),
          )
        }),
    } satisfies EventLogPort
  }),
)
