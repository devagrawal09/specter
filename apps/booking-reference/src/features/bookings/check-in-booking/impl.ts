import { eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import spec from './spec'
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

const checkInBooking = spec
  .inputSchema(
    z.object({
      bookingId: z.string().min(1),
      checkedInByEmail: z.string().email(),
    }),
  )
  .store(sqliteSliceStore)
  .apply(bookingRequestedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(checkInBookingSqlBookings)
      .values({ ...payload, status: 'pending' })
      .onConflictDoNothing()
      .run()
  })
  .apply(bookingApprovedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(checkInBookingSqlBookings)
      .set({ status: 'approved' })
      .where(eq(checkInBookingSqlBookings.bookingId, payload.bookingId))
      .run()
  })
  .apply(bookingCheckedInEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(checkInBookingSqlBookings)
      .set({ status: 'checkedIn' })
      .where(eq(checkInBookingSqlBookings.bookingId, payload.bookingId))
      .run()
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
