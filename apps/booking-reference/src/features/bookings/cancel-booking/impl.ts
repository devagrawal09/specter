import { eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
import { sqliteSliceStore } from '../../../db/specter-store'
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

const cancelBooking = implementCommand(specification)
  .inputSchema(
    z.object({
      bookingId: z.string().min(1),
      canceledByEmail: z.string().email(),
      reason: z.string(),
    }),
  )
  .store(sqliteSliceStore)
  .apply(bookingRequestedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(cancelBookingSqlBookings)
      .values({ ...payload, status: 'pending' })
      .onConflictDoNothing()
      .run()
  })
  .apply(bookingApprovedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(cancelBookingSqlBookings)
      .set({ status: 'approved' })
      .where(eq(cancelBookingSqlBookings.bookingId, payload.bookingId))
      .run()
  })
  .apply(bookingCanceledEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(cancelBookingSqlBookings)
      .set({ status: 'canceled' })
      .where(eq(cancelBookingSqlBookings.bookingId, payload.bookingId))
      .run()
  })
  .handle(async (command, db) => {
    const reason = command.reason.trim()
    if (!reason) throw new Error('Cancel reason is required')
    const booking = (
      await db
        .select()
        .from(cancelBookingSqlBookings)
        .where(eq(cancelBookingSqlBookings.bookingId, command.bookingId))
        .all()
    )[0]
    if (!booking) throw new Error('Booking not found')
    if (!['pending', 'approved'].includes(booking.status))
      throw new Error('Only pending or approved bookings can be canceled')
    return [bookingCanceledEvent.create({ ...command, reason })]
  })

export default cancelBooking
