import { eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createCommandSlice } from '@specter-ts/core'
import { sqliteSliceStore } from '../../../db/specter-sqlite'
import { bookingApprovedEvent, bookingRequestedEvent } from '../events'

export const approveBookingSqlBookings = sqliteTable(
  'approve_booking_sql_bookings',
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

const approveBooking = createCommandSlice('approveBooking')
  .schema(
    z.object({
      bookingId: z.string().min(1),
      approverEmail: z.string().email(),
      approverName: z.string(),
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
        approverEmail: 'lin@example.com',
        approverName: 'Lin',
      },
      expect: [
        bookingApprovedEvent.create({
          bookingId: 'booking-1',
          approverEmail: 'lin@example.com',
          approverName: 'Lin',
        }),
      ],
    },
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
        approverEmail: 'ada@example.com',
        approverName: 'Ada',
      },
      expect: [],
      reject: { reason: 'Requester cannot approve their own booking' },
    },
  )
  .apply({
    [bookingRequestedEvent.type]: async (event, db) => {
      const payload = await bookingRequestedEvent.decode(event.payload)
      db.insert(approveBookingSqlBookings)
        .values({ ...payload, status: 'pending' })
        .run()
    },
    [bookingApprovedEvent.type]: async (event, db) => {
      const payload = await bookingApprovedEvent.decode(event.payload)
      db.update(approveBookingSqlBookings)
        .set({ status: 'approved' })
        .where(eq(approveBookingSqlBookings.bookingId, payload.bookingId))
        .run()
    },
  })
  .handle(async (command, db) => {
    const approverName = command.approverName.trim()
    if (!approverName) throw new Error('Approver name is required')
    const booking = db
      .select()
      .from(approveBookingSqlBookings)
      .where(eq(approveBookingSqlBookings.bookingId, command.bookingId))
      .all()[0]
    if (!booking) throw new Error('Booking not found')
    if (booking.status !== 'pending')
      throw new Error('Only pending bookings can be approved')
    if (booking.requesterEmail === command.approverEmail)
      throw new Error('Requester cannot approve their own booking')
    return [bookingApprovedEvent.create({ ...command, approverName })]
  })

export default approveBooking
