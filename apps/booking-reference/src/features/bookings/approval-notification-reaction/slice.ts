import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createReactionSlice } from '@specter-ts/core'
import { sqliteSliceStore } from '../../../db/specter-sqlite'
import {
  approvalNotificationRecordedEvent,
  bookingApprovedEvent,
  bookingRequestedEvent,
} from '../events'

export const approvalNotificationSqlStates = sqliteTable(
  'approval_notification_sql_states',
  {
    bookingId: text('booking_id').primaryKey(),
    approved: integer('approved', { mode: 'boolean' }).notNull().default(false),
    notified: integer('notified', { mode: 'boolean' }).notNull().default(false),
  },
)

const approvalNotificationReaction = createReactionSlice(
  'approvalNotificationReaction',
)
  .plugin(async (command) => async (payload) => command(payload as never))
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
        bookingApprovedEvent.create({
          bookingId: 'booking-1',
          approverEmail: 'lin@example.com',
          approverName: 'Lin',
        }),
      ],
      expect: [
        {
          type: 'recordApprovalNotification',
          payload: { bookingId: 'booking-1' },
        },
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
        bookingApprovedEvent.create({
          bookingId: 'booking-1',
          approverEmail: 'lin@example.com',
          approverName: 'Lin',
        }),
        approvalNotificationRecordedEvent.create({
          bookingId: 'booking-1',
          message: "Ada's booking for Planning was approved.",
        }),
      ],
      expect: [],
    },
  )
  .apply({
    [bookingRequestedEvent.type]: async (event, db) => {
      const payload = await bookingRequestedEvent.decode(event.payload)
      db.insert(approvalNotificationSqlStates)
        .values({
          bookingId: payload.bookingId,
          approved: false,
          notified: false,
        })
        .run()
    },
    [bookingApprovedEvent.type]: async (event, db) => {
      const payload = await bookingApprovedEvent.decode(event.payload)
      db.update(approvalNotificationSqlStates)
        .set({ approved: true })
        .where(eq(approvalNotificationSqlStates.bookingId, payload.bookingId))
        .run()
    },
    [approvalNotificationRecordedEvent.type]: async (event, db) => {
      const payload = await approvalNotificationRecordedEvent.decode(
        event.payload,
      )
      db.update(approvalNotificationSqlStates)
        .set({ notified: true })
        .where(eq(approvalNotificationSqlStates.bookingId, payload.bookingId))
        .run()
    },
  })
  .handle(async (db) => {
    const pending = db
      .select()
      .from(approvalNotificationSqlStates)
      .all()
      .find((row) => row.approved && !row.notified)

    if (!pending) return

    return {
      type: 'recordApprovalNotification',
      payload: { bookingId: pending.bookingId },
    }
  })

export default approvalNotificationReaction
