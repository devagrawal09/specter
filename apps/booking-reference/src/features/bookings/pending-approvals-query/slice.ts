import { eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createQuerySlice } from '@specter-ts/core'
import { sqliteSliceStore } from '../../../db/specter-sqlite'
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

const pendingApprovalsQuery = createQuerySlice(
  'pendingApprovalsQuery',
  'Lists bookings still awaiting approval.',
)
  .schema(z.object({}))
  .store(sqliteSliceStore)
  .apply({
    [bookingRequestedEvent.type]: async (event, db) => {
      const payload = await bookingRequestedEvent.decode(event.payload)
      db.insert(pendingApprovalRows)
        .values({ ...payload, status: 'pending' })
        .run()
    },
    [bookingApprovedEvent.type]: async (event, db) => {
      const payload = await bookingApprovedEvent.decode(event.payload)
      db.update(pendingApprovalRows)
        .set({ status: 'approved' })
        .where(eq(pendingApprovalRows.bookingId, payload.bookingId))
        .run()
    },
    [bookingRejectedEvent.type]: async (event, db) => {
      const payload = await bookingRejectedEvent.decode(event.payload)
      db.update(pendingApprovalRows)
        .set({ status: 'rejected' })
        .where(eq(pendingApprovalRows.bookingId, payload.bookingId))
        .run()
    },
    [bookingCanceledEvent.type]: async (event, db) => {
      const payload = await bookingCanceledEvent.decode(event.payload)
      db.update(pendingApprovalRows)
        .set({ status: 'canceled' })
        .where(eq(pendingApprovalRows.bookingId, payload.bookingId))
        .run()
    },
  })
  .scenarios({
    description: 'Returns pending booking requests.',
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
    ],
    when: {},
    expect: [
      {
        bookingId: 'booking-1',
        roomId: 'room-1',
        requesterEmail: 'ada@example.com',
        requesterName: 'Ada',
        purpose: 'Planning',
        startsAt: '2026-06-01T09:00:00.000Z',
        endsAt: '2026-06-01T10:00:00.000Z',
        status: 'pending',
      },
    ],
  })
  .handle(async (_query, db) => {
    return db
      .select()
      .from(pendingApprovalRows)
      .where(eq(pendingApprovalRows.status, 'pending'))
      .all()
  })

export default pendingApprovalsQuery
