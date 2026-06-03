import { eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createCommandSlice } from '@specter-ts/core'
import { sqliteSliceStore } from '../../../db/specter-sqlite'
import {
  bookingApprovedEvent,
  bookingCheckedInEvent,
  bookingRequestedEvent,
} from '../events'

export const checkInBookingSqlBookings = sqliteTable(
  'check_in_booking_sql_bookings',
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

const checkInBooking = createCommandSlice(
  'checkInBooking',
  'Checks approved bookings into their room.',
)
  .schema(
    z.object({
      bookingId: z.string().min(1),
      checkedInByEmail: z.string().email(),
    }),
  )
  .store(sqliteSliceStore)
  .scenarios(
    {
      description: 'Checks in an approved booking.',
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
        bookingApprovedEvent.create({
          bookingId: 'booking-1',
          approverEmail: 'lin@example.com',
          approverName: 'Lin',
        }),
      ],
      when: { bookingId: 'booking-1', checkedInByEmail: 'ada@example.com' },
      expect: [
        bookingCheckedInEvent.create({
          bookingId: 'booking-1',
          checkedInByEmail: 'ada@example.com',
        }),
      ],
    },
    {
      description: 'Rejects checking in a missing booking.',
      given: [],
      when: { bookingId: 'missing', checkedInByEmail: 'ada@example.com' },
      expect: [],
      reject: { reason: 'Booking not found' },
    },
  )
  .apply({
    [bookingRequestedEvent.type]: async (event, db) => {
      const payload = await bookingRequestedEvent.decode(event.payload)
      await db
        .insert(checkInBookingSqlBookings)
        .values({ ...payload, status: 'pending' })
        .run()
    },
    [bookingApprovedEvent.type]: async (event, db) => {
      const payload = await bookingApprovedEvent.decode(event.payload)
      await db
        .update(checkInBookingSqlBookings)
        .set({ status: 'approved' })
        .where(eq(checkInBookingSqlBookings.bookingId, payload.bookingId))
        .run()
    },
    [bookingCheckedInEvent.type]: async (event, db) => {
      const payload = await bookingCheckedInEvent.decode(event.payload)
      await db
        .update(checkInBookingSqlBookings)
        .set({ status: 'checkedIn' })
        .where(eq(checkInBookingSqlBookings.bookingId, payload.bookingId))
        .run()
    },
  })
  .handle(async (command, db) => {
    const booking = (
      await db
        .select()
        .from(checkInBookingSqlBookings)
        .where(eq(checkInBookingSqlBookings.bookingId, command.bookingId))
        .all()
    )[0]
    if (!booking) throw new Error('Booking not found')
    if (booking.status !== 'approved')
      throw new Error('Only approved bookings can be checked in')
    return [bookingCheckedInEvent.create(command)]
  })

export default checkInBooking
