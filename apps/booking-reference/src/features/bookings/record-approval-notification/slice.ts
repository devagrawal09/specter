import { eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createCommandSlice } from '@specter-ts/core'
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

const recordApprovalNotification = createCommandSlice(
  'recordApprovalNotification',
  'Records notifications for approved bookings.',
)
  .schema(z.object({ bookingId: z.string().min(1) }))
  .store(sqliteSliceStore)
  .scenarios(
    {
      description: 'Records a notification for an approved booking.',
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
      when: { bookingId: 'booking-1' },
      expect: [
        approvalNotificationRecordedEvent.create({
          bookingId: 'booking-1',
          message: "Ada's booking for Planning was approved.",
        }),
      ],
    },
    {
      description: 'Rejects notification recording for a missing booking.',
      given: [],
      when: { bookingId: 'missing' },
      expect: [],
      reject: { reason: 'Booking not found' },
    },
  )
  .apply({
    [bookingRequestedEvent.type]: async (event, db) => {
      const payload = await bookingRequestedEvent.decode(event.payload)
      db.insert(recordApprovalNotificationSqlBookings)
        .values({ ...payload, status: 'pending' })
        .run()
    },
    [bookingApprovedEvent.type]: async (event, db) => {
      const payload = await bookingApprovedEvent.decode(event.payload)
      db.update(recordApprovalNotificationSqlBookings)
        .set({ status: 'approved' })
        .where(
          eq(
            recordApprovalNotificationSqlBookings.bookingId,
            payload.bookingId,
          ),
        )
        .run()
    },
  })
  .handle(async (command, db) => {
    const booking = db
      .select()
      .from(recordApprovalNotificationSqlBookings)
      .where(
        eq(recordApprovalNotificationSqlBookings.bookingId, command.bookingId),
      )
      .all()[0]
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
