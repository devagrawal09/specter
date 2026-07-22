import { eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
import { sqliteSliceStore } from '../../../db/specter-store'
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

const approveBooking = implementCommand(specification)
  .inputSchema(
    z.object({
      bookingId: z.string().min(1),
      approverEmail: z.string().email(),
      approverName: z.string(),
    }),
  )
  .store(sqliteSliceStore)
  .apply(bookingRequestedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(approveBookingSqlBookings)
      .values({ ...payload, status: 'pending' })
      .onConflictDoNothing()
      .run()
  })
  .apply(bookingApprovedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(approveBookingSqlBookings)
      .set({ status: 'approved' })
      .where(eq(approveBookingSqlBookings.bookingId, payload.bookingId))
      .run()
  })
  .handle(async (command, db) => {
    const approverName = command.approverName.trim()
    if (!approverName) throw new Error('Approver name is required')
    const booking = (
      await db
        .select()
        .from(approveBookingSqlBookings)
        .where(eq(approveBookingSqlBookings.bookingId, command.bookingId))
        .all()
    )[0]
    if (!booking) throw new Error('Booking not found')
    if (booking.status !== 'pending')
      throw new Error('Only pending bookings can be approved')
    if (booking.requesterEmail === command.approverEmail)
      throw new Error('Requester cannot approve their own booking')
    return [bookingApprovedEvent.create({ ...command, approverName })]
  })

export default approveBooking
