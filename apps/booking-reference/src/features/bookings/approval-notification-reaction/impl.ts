import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import spec from './spec'
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

const approvalNotificationReaction = spec
  .outputSchema(
    z.object({
      type: z.literal('recordApprovalNotification'),
      payload: z.object({ bookingId: z.string() }),
    }),
  )
  .store(sqliteSliceStore)
  .apply(bookingRequestedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(approvalNotificationSqlStates)
      .values({
        bookingId: payload.bookingId,
        approved: false,
        notified: false,
      })
      .onConflictDoNothing()
      .run()
  })
  .apply(bookingApprovedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(approvalNotificationSqlStates)
      .set({ approved: true })
      .where(eq(approvalNotificationSqlStates.bookingId, payload.bookingId))
      .run()
  })
  .apply(approvalNotificationRecordedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(approvalNotificationSqlStates)
      .set({ notified: true })
      .where(eq(approvalNotificationSqlStates.bookingId, payload.bookingId))
      .run()
  })
  .handle(async (db) => {
    const pending = (
      await db.select().from(approvalNotificationSqlStates).all()
    ).find((row) => row.approved && !row.notified)

    if (!pending) return

    return {
      type: 'recordApprovalNotification',
      payload: { bookingId: pending.bookingId },
    }
  })

export default approvalNotificationReaction
