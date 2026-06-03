import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createQuerySlice } from '@specter-ts/core'
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

const roomScheduleQuery = createQuerySlice(
  'roomScheduleQuery',
  'Shows room schedules with filtered bookings.',
)
  .schema(
    z.object({ day: z.string().optional(), status: z.string().optional() }),
  )
  .store(sqliteSliceStore)
  .apply({
    [roomCreatedEvent.type]: async (event, db) => {
      const payload = await roomCreatedEvent.decode(event.payload)
      await db
        .insert(roomScheduleRooms)
        .values({ ...payload, retired: false })
        .run()
    },
    [roomRetiredEvent.type]: async (event, db) => {
      const payload = await roomRetiredEvent.decode(event.payload)
      await db
        .update(roomScheduleRooms)
        .set({ retired: true })
        .where(eq(roomScheduleRooms.roomId, payload.roomId))
        .run()
    },
    [bookingRequestedEvent.type]: async (event, db) => {
      const payload = await bookingRequestedEvent.decode(event.payload)
      await db
        .insert(roomScheduleBookings)
        .values({ ...payload, status: 'pending' })
        .run()
    },
    [bookingApprovedEvent.type]: async (event, db) =>
      updateStatus(db, event.payload, 'approved'),
    [bookingRejectedEvent.type]: async (event, db) =>
      updateStatus(db, event.payload, 'rejected'),
    [bookingCanceledEvent.type]: async (event, db) =>
      updateStatus(db, event.payload, 'canceled'),
    [bookingCheckedInEvent.type]: async (event, db) =>
      updateStatus(db, event.payload, 'checkedIn'),
    [roomReleasedEvent.type]: async (event, db) =>
      updateStatus(db, event.payload, 'released'),
    [bookingRescheduledEvent.type]: async (event, db) => {
      const payload = await bookingRescheduledEvent.decode(event.payload)
      await db
        .update(roomScheduleBookings)
        .set({
          roomId: payload.roomId,
          startsAt: payload.startsAt,
          endsAt: payload.endsAt,
        })
        .where(eq(roomScheduleBookings.bookingId, payload.bookingId))
        .run()
    },
  })
  .scenarios({
    description: 'Returns rooms with bookings for the requested day.',
    given: [
      roomCreatedEvent.create({
        roomId: 'room-1',
        name: 'Library',
        capacity: 6,
        location: 'Floor 1',
      }),
      bookingRequestedEvent.create({
        bookingId: 'booking-1',
        roomId: 'room-1',
        requesterEmail: 'ada@example.com',
        requesterName: 'Ada',
        purpose: 'Planning',
        startsAt: '2026-06-01T09:00:00.000Z',
        endsAt: '2026-06-01T10:00:00.000Z',
      }),
    ],
    when: { day: '2026-06-01', status: 'all' },
    expect: [
      {
        roomId: 'room-1',
        name: 'Library',
        capacity: 6,
        location: 'Floor 1',
        retired: false,
        bookings: [
          {
            bookingId: 'booking-1',
            roomId: 'room-1',
            requesterEmail: 'ada@example.com',
            requesterName: 'Ada',
            purpose: 'Planning',
            startsAt: '2026-06-01T09:00:00.000Z',
            endsAt: '2026-06-01T10:00:00.000Z',
            status: 'pending',
          },
        ],
      },
    ],
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
