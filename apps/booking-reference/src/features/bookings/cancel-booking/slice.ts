import { eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createCommandSlice } from '@specter-ts/core'
import { sqliteSliceStore } from '../../../db/specter-sqlite'
import {
  bookingApprovedEvent,
  bookingCanceledEvent,
  bookingRequestedEvent,
} from '../events'

export const cancelBookingSqlBookings = sqliteTable(
  'cancel_booking_sql_bookings',
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

const cancelBooking = createCommandSlice('cancelBooking')
  .schema(
    z.object({
      bookingId: z.string().min(1),
      canceledByEmail: z.string().email(),
      reason: z.string(),
    }),
  )
  .store(sqliteSliceStore)
  .scenarios(
    {
      given: [
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
        canceledByEmail: 'ada@example.com',
        reason: 'No longer needed',
      },
      expect: [
        bookingCanceledEvent.create({
          bookingId: 'booking-1',
          canceledByEmail: 'ada@example.com',
          reason: 'No longer needed',
        }),
      ],
    },
    {
      given: [],
      when: {
        bookingId: 'missing',
        canceledByEmail: 'ada@example.com',
        reason: 'Nope',
      },
      expect: [],
      reject: { reason: 'Booking not found' },
    },
  )
  .apply({
    [bookingRequestedEvent.type]: async (event, db) => {
      const payload = await bookingRequestedEvent.decode(event.payload)
      db.insert(cancelBookingSqlBookings)
        .values({ ...payload, status: 'pending' })
        .run()
    },
    [bookingApprovedEvent.type]: async (event, db) => {
      const payload = await bookingApprovedEvent.decode(event.payload)
      db.update(cancelBookingSqlBookings)
        .set({ status: 'approved' })
        .where(eq(cancelBookingSqlBookings.bookingId, payload.bookingId))
        .run()
    },
    [bookingCanceledEvent.type]: async (event, db) => {
      const payload = await bookingCanceledEvent.decode(event.payload)
      db.update(cancelBookingSqlBookings)
        .set({ status: 'canceled' })
        .where(eq(cancelBookingSqlBookings.bookingId, payload.bookingId))
        .run()
    },
  })
  .handle(async (command, db) => {
    const reason = command.reason.trim()
    if (!reason) throw new Error('Cancel reason is required')
    const booking = db
      .select()
      .from(cancelBookingSqlBookings)
      .where(eq(cancelBookingSqlBookings.bookingId, command.bookingId))
      .all()[0]
    if (!booking) throw new Error('Booking not found')
    if (!['pending', 'approved'].includes(booking.status))
      throw new Error('Only pending or approved bookings can be canceled')
    return [bookingCanceledEvent.create({ ...command, reason })]
  })

export default cancelBooking
