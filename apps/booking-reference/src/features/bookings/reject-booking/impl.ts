import { eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
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

const rejectBooking = implementCommand<'rejectBooking'>(specification)
  .inputSchema(
    z.object({
      bookingId: z.string().min(1),
      approverEmail: z.string().email(),
      approverName: z.string(),
      reason: z.string(),
    }),
  )
  .store(sqliteSliceStore)
  .apply(bookingRequestedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(rejectBookingSqlBookings)
      .values({ ...payload, status: 'pending' })
      .onConflictDoNothing()
      .run()
  })
  .apply(bookingRejectedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(rejectBookingSqlBookings)
      .set({ status: 'rejected' })
      .where(eq(rejectBookingSqlBookings.bookingId, payload.bookingId))
      .run()
  })
  .handle(async (command, db) => {
    const reason = command.reason.trim()
    const approverName = command.approverName.trim()
    if (!approverName) throw new Error('Approver name is required')
    if (!reason) throw new Error('Rejection reason is required')
    const booking = (
      await db
        .select()
        .from(rejectBookingSqlBookings)
        .where(eq(rejectBookingSqlBookings.bookingId, command.bookingId))
        .all()
    )[0]
    if (!booking) throw new Error('Booking not found')
    if (booking.status !== 'pending')
      throw new Error('Only pending bookings can be rejected')
    return [bookingRejectedEvent.create({ ...command, approverName, reason })]
  })

export default rejectBooking
