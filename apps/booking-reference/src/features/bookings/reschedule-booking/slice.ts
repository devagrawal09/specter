import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createCommandSlice } from '@specter-ts/core'
import { sqliteSliceStore } from '../../../db/specter-sqlite'
import { activeBookingStatuses, overlaps } from '../booking-state'
import {
  bookingCanceledEvent,
  bookingRejectedEvent,
  bookingRequestedEvent,
  bookingRescheduledEvent,
  roomCreatedEvent,
  roomRetiredEvent,
} from '../events'

export const rescheduleBookingSqlRooms = sqliteTable(
  'reschedule_booking_sql_rooms',
  {
    roomId: text('room_id').primaryKey(),
    name: text('name').notNull(),
    capacity: integer('capacity').notNull(),
    location: text('location').notNull(),
    retired: integer('retired', { mode: 'boolean' }).notNull().default(false),
  },
)

export const rescheduleBookingSqlBookings = sqliteTable(
  'reschedule_booking_sql_bookings',
  {
    bookingId: text('booking_id').primaryKey(),
    roomId: text('room_id').notNull(),
    requesterEmail: text('requester_email').notNull(),
    requesterName: text('requester_name').notNull(),
    purpose: text('purpose').notNull(),
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at').notNull(),
    status: text('status').notNull(),
  },
)

const rescheduleBooking = createCommandSlice('rescheduleBooking')
  .schema(
    z.object({
      bookingId: z.string().min(1),
      roomId: z.string().min(1),
      startsAt: z.string(),
      endsAt: z.string(),
    }),
  )
  .store(sqliteSliceStore)
  .scenarios(
    {
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
      when: {
        bookingId: 'booking-1',
        roomId: 'room-1',
        startsAt: '2026-06-01T10:00:00.000Z',
        endsAt: '2026-06-01T11:00:00.000Z',
      },
      expect: [
        bookingRescheduledEvent.create({
          bookingId: 'booking-1',
          roomId: 'room-1',
          startsAt: '2026-06-01T10:00:00.000Z',
          endsAt: '2026-06-01T11:00:00.000Z',
        }),
      ],
    },
    {
      given: [],
      when: {
        bookingId: 'missing',
        roomId: 'room-1',
        startsAt: '2026-06-01T10:00:00.000Z',
        endsAt: '2026-06-01T11:00:00.000Z',
      },
      expect: [],
      reject: { reason: 'Booking not found' },
    },
  )
  .apply({
    [roomCreatedEvent.type]: async (event, db) => {
      const payload = await roomCreatedEvent.decode(event.payload)
      db.insert(rescheduleBookingSqlRooms)
        .values({ ...payload, retired: false })
        .run()
    },
    [roomRetiredEvent.type]: async (event, db) => {
      const payload = await roomRetiredEvent.decode(event.payload)
      db.update(rescheduleBookingSqlRooms)
        .set({ retired: true })
        .where(eq(rescheduleBookingSqlRooms.roomId, payload.roomId))
        .run()
    },
    [bookingRequestedEvent.type]: async (event, db) => {
      const payload = await bookingRequestedEvent.decode(event.payload)
      db.insert(rescheduleBookingSqlBookings)
        .values({ ...payload, status: 'pending' })
        .run()
    },
    [bookingRejectedEvent.type]: async (event, db) => {
      const payload = await bookingRejectedEvent.decode(event.payload)
      db.update(rescheduleBookingSqlBookings)
        .set({ status: 'rejected' })
        .where(eq(rescheduleBookingSqlBookings.bookingId, payload.bookingId))
        .run()
    },
    [bookingCanceledEvent.type]: async (event, db) => {
      const payload = await bookingCanceledEvent.decode(event.payload)
      db.update(rescheduleBookingSqlBookings)
        .set({ status: 'canceled' })
        .where(eq(rescheduleBookingSqlBookings.bookingId, payload.bookingId))
        .run()
    },
    [bookingRescheduledEvent.type]: async (event, db) => {
      const payload = await bookingRescheduledEvent.decode(event.payload)
      db.update(rescheduleBookingSqlBookings)
        .set({
          roomId: payload.roomId,
          startsAt: payload.startsAt,
          endsAt: payload.endsAt,
        })
        .where(eq(rescheduleBookingSqlBookings.bookingId, payload.bookingId))
        .run()
    },
  })
  .handle(async (command, db) => {
    if (command.startsAt >= command.endsAt)
      throw new Error('Booking start must be before end')
    const booking = db
      .select()
      .from(rescheduleBookingSqlBookings)
      .where(eq(rescheduleBookingSqlBookings.bookingId, command.bookingId))
      .all()[0]
    if (!booking) throw new Error('Booking not found')
    if (!['pending', 'approved'].includes(booking.status))
      throw new Error('Only pending or approved bookings can be rescheduled')
    const room = db
      .select()
      .from(rescheduleBookingSqlRooms)
      .where(eq(rescheduleBookingSqlRooms.roomId, command.roomId))
      .all()[0]
    if (!room || room.retired) throw new Error('Room is not available')
    const conflicting = db
      .select()
      .from(rescheduleBookingSqlBookings)
      .where(eq(rescheduleBookingSqlBookings.roomId, command.roomId))
      .all()
      .find(
        (row) =>
          row.bookingId !== command.bookingId &&
          activeBookingStatuses.includes(row.status) &&
          overlaps(row.startsAt, row.endsAt, command.startsAt, command.endsAt),
      )
    if (conflicting) throw new Error('Room is already held for that time')
    return [bookingRescheduledEvent.create(command)]
  })

export default rescheduleBooking
