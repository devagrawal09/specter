import { eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createCommandSlice } from '@specter-ts/core'
import { sqliteSliceStore } from '../../../db/specter-sqlite'
import { bookingRejectedEvent, bookingRequestedEvent } from '../events'

export const rejectBookingSqlBookings = sqliteTable(
  'reject_booking_sql_bookings',
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

const rejectBooking = createCommandSlice(
  'rejectBooking',
  'Rejects pending booking requests.',
)
  .schema(
    z.object({
      bookingId: z.string().min(1),
      approverEmail: z.string().email(),
      approverName: z.string(),
      reason: z.string(),
    }),
  )
  .store(sqliteSliceStore)
  .scenarios(
    {
      description: 'Rejects a pending booking with a reason.',
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
        approverEmail: 'lin@example.com',
        approverName: 'Lin',
        reason: 'Too small',
      },
      expect: [
        bookingRejectedEvent.create({
          bookingId: 'booking-1',
          approverEmail: 'lin@example.com',
          approverName: 'Lin',
          reason: 'Too small',
        }),
      ],
    },
    {
      description: 'Rejects a rejection for a missing booking.',
      given: [],
      when: {
        bookingId: 'missing',
        approverEmail: 'lin@example.com',
        approverName: 'Lin',
        reason: 'Nope',
      },
      expect: [],
      reject: { reason: 'Booking not found' },
    },
  )
  .apply({
    [bookingRequestedEvent.type]: async (event, db) => {
      const payload = await bookingRequestedEvent.decode(event.payload)
      db.insert(rejectBookingSqlBookings)
        .values({ ...payload, status: 'pending' })
        .run()
    },
    [bookingRejectedEvent.type]: async (event, db) => {
      const payload = await bookingRejectedEvent.decode(event.payload)
      db.update(rejectBookingSqlBookings)
        .set({ status: 'rejected' })
        .where(eq(rejectBookingSqlBookings.bookingId, payload.bookingId))
        .run()
    },
  })
  .handle(async (command, db) => {
    const reason = command.reason.trim()
    const approverName = command.approverName.trim()
    if (!approverName) throw new Error('Approver name is required')
    if (!reason) throw new Error('Rejection reason is required')
    const booking = db
      .select()
      .from(rejectBookingSqlBookings)
      .where(eq(rejectBookingSqlBookings.bookingId, command.bookingId))
      .all()[0]
    if (!booking) throw new Error('Booking not found')
    if (booking.status !== 'pending')
      throw new Error('Only pending bookings can be rejected')
    return [bookingRejectedEvent.create({ ...command, approverName, reason })]
  })

export default rejectBooking
