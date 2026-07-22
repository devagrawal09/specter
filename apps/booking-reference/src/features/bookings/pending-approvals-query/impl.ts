import { eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import specification from './spec.json' with { type: 'json' }
import { implementQuery } from '@specter-ts/core'
import { sqliteSliceStore } from '../../../db/specter-store'
import {
  bookingApprovedEvent,
  bookingCanceledEvent,
  bookingRejectedEvent,
  bookingRequestedEvent,
} from '../events'

export const pendingApprovalRows = sqliteTable('pending_approval_rows', {
  bookingId: text('booking_id').primaryKey(),
  roomId: text('room_id').notNull(),
  requesterEmail: text('requester_email').notNull(),
  requesterName: text('requester_name').notNull(),
  purpose: text('purpose').notNull(),
  startsAt: text('starts_at').notNull(),
  endsAt: text('ends_at').notNull(),
  status: text('status').notNull(),
})

const pendingApprovalsQuery = implementQuery(specification)
  .inputSchema(z.object({}))
  .outputSchema(
    z.array(
      z.object({
        bookingId: z.string(),
        roomId: z.string(),
        requesterEmail: z.string(),
        requesterName: z.string(),
        purpose: z.string(),
        startsAt: z.string(),
        endsAt: z.string(),
        status: z.string(),
      }),
    ),
  )
  .store(sqliteSliceStore)
  .apply(bookingRequestedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(pendingApprovalRows)
      .values({ ...payload, status: 'pending' })
      .onConflictDoNothing()
      .run()
  })
  .apply(bookingApprovedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(pendingApprovalRows)
      .set({ status: 'approved' })
      .where(eq(pendingApprovalRows.bookingId, payload.bookingId))
      .run()
  })
  .apply(bookingRejectedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(pendingApprovalRows)
      .set({ status: 'rejected' })
      .where(eq(pendingApprovalRows.bookingId, payload.bookingId))
      .run()
  })
  .apply(bookingCanceledEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(pendingApprovalRows)
      .set({ status: 'canceled' })
      .where(eq(pendingApprovalRows.bookingId, payload.bookingId))
      .run()
  })
  .handle(async (_query, db) => {
    return await db
      .select()
      .from(pendingApprovalRows)
      .where(eq(pendingApprovalRows.status, 'pending'))
      .all()
  })

export default pendingApprovalsQuery
