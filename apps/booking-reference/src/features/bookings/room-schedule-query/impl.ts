import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import spec from './spec'
import type { ScopedSqliteDb } from '../../../db/specter-sqlite'
import { sqliteSliceStore } from '../../../db/specter-sqlite'
import {
  bookingApprovedEvent,
  bookingCanceledEvent,
  bookingCheckedInEvent,
  bookingRejectedEvent,
  bookingRequestedEvent,
  bookingRescheduledEvent,
  roomCreatedEvent,
  roomReleasedEvent,
  roomRetiredEvent,
} from '../events'

export const roomScheduleRooms = sqliteTable('room_schedule_rooms', {
  roomId: text('room_id').primaryKey(),
  name: text('name').notNull(),
  capacity: integer('capacity').notNull(),
  location: text('location').notNull(),
  retired: integer('retired', { mode: 'boolean' }).notNull().default(false),
})

export const roomScheduleBookings = sqliteTable('room_schedule_bookings', {
  bookingId: text('booking_id').primaryKey(),
  roomId: text('room_id').notNull(),
  requesterEmail: text('requester_email').notNull(),
  requesterName: text('requester_name').notNull(),
  purpose: text('purpose').notNull(),
  startsAt: text('starts_at').notNull(),
  endsAt: text('ends_at').notNull(),
  status: text('status').notNull(),
})

const roomScheduleQuery = spec
  .inputSchema(
    z.object({ day: z.string().optional(), status: z.string().optional() }),
  )
  .outputSchema(
    z.array(
      z.object({
        roomId: z.string(),
        name: z.string(),
        capacity: z.number(),
        location: z.string(),
        retired: z.boolean(),
        bookings: z.array(
          z.object({
            bookingId: z.string(),
            roomId: z.string(),
            requesterEmail: z.string(),
            requesterName: z.string(),
            purpose: z.string(),
            startsAt: z.string(),
            endsAt: z.string(),
            status: z.string(),
          }),
        ),
      }),
    ),
  )
  .store(sqliteSliceStore)
  .apply(roomCreatedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(roomScheduleRooms)
      .values({ ...payload, retired: false })
      .onConflictDoNothing()
      .run()
  })
  .apply(roomRetiredEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(roomScheduleRooms)
      .set({ retired: true })
      .where(eq(roomScheduleRooms.roomId, payload.roomId))
      .run()
  })
  .apply(bookingRequestedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(roomScheduleBookings)
      .values({ ...payload, status: 'pending' })
      .onConflictDoNothing()
      .run()
  })
  .apply(bookingApprovedEvent, async (event, db) =>
    updateStatus(db, event.payload, 'approved'),
  )
  .apply(bookingRejectedEvent, async (event, db) =>
    updateStatus(db, event.payload, 'rejected'),
  )
  .apply(bookingCanceledEvent, async (event, db) =>
    updateStatus(db, event.payload, 'canceled'),
  )
  .apply(bookingCheckedInEvent, async (event, db) =>
    updateStatus(db, event.payload, 'checkedIn'),
  )
  .apply(roomReleasedEvent, async (event, db) =>
    updateStatus(db, event.payload, 'released'),
  )
  .apply(bookingRescheduledEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(roomScheduleBookings)
      .set({
        roomId: payload.roomId,
        startsAt: payload.startsAt,
        endsAt: payload.endsAt,
      })
      .where(eq(roomScheduleBookings.bookingId, payload.bookingId))
      .run()
  })
  .handle(async (query, db) => {
    const rooms = await db.select().from(roomScheduleRooms).all()
    const bookings = await db.select().from(roomScheduleBookings).all()
    const day = query.day
    const status =
      query.status && query.status !== 'all' ? query.status : undefined

    return rooms.map((room) => ({
      ...room,
      bookings: bookings
        .filter((booking) => booking.roomId === room.roomId)
        .filter((booking) => !day || booking.startsAt.slice(0, 10) === day)
        .filter((booking) => !status || booking.status === status)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    }))
  })

async function updateStatus(
  db: ScopedSqliteDb,
  payload: unknown,
  status: string,
) {
  const bookingId = (payload as { bookingId: string }).bookingId
  await db
    .update(roomScheduleBookings)
    .set({ status })
    .where(eq(roomScheduleBookings.bookingId, bookingId))
    .run()
}

export default roomScheduleQuery
