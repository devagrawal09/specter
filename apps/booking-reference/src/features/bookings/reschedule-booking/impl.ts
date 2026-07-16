import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import spec from './spec'
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

const rescheduleBooking = spec
  .inputSchema(
    z.object({
      bookingId: z.string().min(1),
      roomId: z.string().min(1),
      startsAt: z.string(),
      endsAt: z.string(),
    }),
  )
  .store(sqliteSliceStore)
  .apply(roomCreatedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(rescheduleBookingSqlRooms)
      .values({ ...payload, retired: false })
      .onConflictDoNothing()
      .run()
  })
  .apply(roomRetiredEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(rescheduleBookingSqlRooms)
      .set({ retired: true })
      .where(eq(rescheduleBookingSqlRooms.roomId, payload.roomId))
      .run()
  })
  .apply(bookingRequestedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(rescheduleBookingSqlBookings)
      .values({ ...payload, status: 'pending' })
      .onConflictDoNothing()
      .run()
  })
  .apply(bookingRejectedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(rescheduleBookingSqlBookings)
      .set({ status: 'rejected' })
      .where(eq(rescheduleBookingSqlBookings.bookingId, payload.bookingId))
      .run()
  })
  .apply(bookingCanceledEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(rescheduleBookingSqlBookings)
      .set({ status: 'canceled' })
      .where(eq(rescheduleBookingSqlBookings.bookingId, payload.bookingId))
      .run()
  })
  .apply(bookingRescheduledEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(rescheduleBookingSqlBookings)
      .set({
        roomId: payload.roomId,
        startsAt: payload.startsAt,
        endsAt: payload.endsAt,
      })
      .where(eq(rescheduleBookingSqlBookings.bookingId, payload.bookingId))
      .run()
  })
  .handle(async (command, db) => {
    if (command.startsAt >= command.endsAt)
      throw new Error('Booking start must be before end')
    const booking = (
      await db
        .select()
        .from(rescheduleBookingSqlBookings)
        .where(eq(rescheduleBookingSqlBookings.bookingId, command.bookingId))
        .all()
    )[0]
    if (!booking) throw new Error('Booking not found')
    if (!['pending', 'approved'].includes(booking.status))
      throw new Error('Only pending or approved bookings can be rescheduled')
    const room = (
      await db
        .select()
        .from(rescheduleBookingSqlRooms)
        .where(eq(rescheduleBookingSqlRooms.roomId, command.roomId))
        .all()
    )[0]
    if (!room || room.retired) throw new Error('Room is not available')
    const conflicting = (
      await db
        .select()
        .from(rescheduleBookingSqlBookings)
        .where(eq(rescheduleBookingSqlBookings.roomId, command.roomId))
        .all()
    ).find(
      (row) =>
        row.bookingId !== command.bookingId &&
        activeBookingStatuses.includes(row.status) &&
        overlaps(row.startsAt, row.endsAt, command.startsAt, command.endsAt),
    )
    if (conflicting) throw new Error('Room is already held for that time')
    return [bookingRescheduledEvent.create(command)]
  })

export default rescheduleBooking
