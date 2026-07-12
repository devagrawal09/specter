import { eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import spec from './spec'
import { sqliteSliceStore } from '../../../db/specter-sqlite'
import {
  approvalNotificationRecordedEvent,
  bookingApprovedEvent,
  bookingRequestedEvent,
} from '../events'

export const recordApprovalNotificationSqlBookings = sqliteTable(
  'record_approval_notification_sql_bookings',
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

const recordApprovalNotification = spec
  .inputSchema(z.object({ bookingId: z.string().min(1) }))
  .store(sqliteSliceStore)
  .apply(bookingRequestedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(recordApprovalNotificationSqlBookings)
      .values({ ...payload, status: 'pending' })
      .run()
  })
  .apply(bookingApprovedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(recordApprovalNotificationSqlBookings)
      .set({ status: 'approved' })
      .where(
        eq(recordApprovalNotificationSqlBookings.bookingId, payload.bookingId),
      )
      .run()
  })
  .handle(async (command, db) => {
    const booking = (
      await db
        .select()
        .from(recordApprovalNotificationSqlBookings)
        .where(
          eq(
            recordApprovalNotificationSqlBookings.bookingId,
            command.bookingId,
          ),
        )
        .all()
    )[0]
    if (!booking) throw new Error('Booking not found')
    if (booking.status !== 'approved')
      throw new Error(
        'Only approved bookings can create approval notifications',
      )
    return [
      approvalNotificationRecordedEvent.create({
        bookingId: command.bookingId,
        message: `${booking.requesterName}'s booking for ${booking.purpose} was approved.`,
      }),
    ]
  })

export default recordApprovalNotification
