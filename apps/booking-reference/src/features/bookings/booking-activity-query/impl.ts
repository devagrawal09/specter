import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import spec from './spec'
import { sqliteSliceStore } from '../../../db/specter-sqlite'
import {
  approvalNotificationRecordedEvent,
  bookingApprovedEvent,
  bookingCanceledEvent,
  bookingCheckedInEvent,
  bookingRejectedEvent,
  bookingRequestedEvent,
  bookingRescheduledEvent,
  roomCreatedEvent,
  roomReleasedEvent,
  roomRetiredEvent,
} from '../events'

export const bookingActivityRows = sqliteTable('booking_activity_rows', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  bookingId: text('booking_id'),
  roomId: text('room_id'),
  kind: text('kind').notNull(),
  message: text('message').notNull(),
})

const bookingActivityQuery = spec
  .inputSchema(z.object({}))
  .outputSchema(
    z.array(
      z.object({
        id: z.number(),
        bookingId: z.string().nullable(),
        roomId: z.string().nullable(),
        kind: z.string(),
        message: z.string(),
      }),
    ),
  )
  .store(sqliteSliceStore)
  .apply(roomCreatedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(bookingActivityRows)
      .values({
        roomId: payload.roomId,
        kind: 'roomCreated',
        message: `Room ${payload.name} opened on ${payload.location}.`,
      })
      .run()
  })
  .apply(roomRetiredEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(bookingActivityRows)
      .values({
        roomId: payload.roomId,
        kind: 'roomRetired',
        message: `Room ${payload.roomId} was retired.`,
      })
      .run()
  })
  .apply(bookingRequestedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(bookingActivityRows)
      .values({
        bookingId: payload.bookingId,
        roomId: payload.roomId,
        kind: 'bookingRequested',
        message: `${payload.requesterName} requested ${payload.purpose}.`,
      })
      .run()
  })
  .apply(bookingApprovedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(bookingActivityRows)
      .values({
        bookingId: payload.bookingId,
        kind: 'bookingApproved',
        message: `${payload.approverName} approved booking ${payload.bookingId}.`,
      })
      .run()
  })
  .apply(bookingRejectedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(bookingActivityRows)
      .values({
        bookingId: payload.bookingId,
        kind: 'bookingRejected',
        message: `${payload.approverName} rejected booking ${payload.bookingId}: ${payload.reason}.`,
      })
      .run()
  })
  .apply(bookingRescheduledEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(bookingActivityRows)
      .values({
        bookingId: payload.bookingId,
        roomId: payload.roomId,
        kind: 'bookingRescheduled',
        message: `Booking ${payload.bookingId} moved to ${payload.startsAt}.`,
      })
      .run()
  })
  .apply(bookingCanceledEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(bookingActivityRows)
      .values({
        bookingId: payload.bookingId,
        kind: 'bookingCanceled',
        message: `Booking ${payload.bookingId} was canceled: ${payload.reason}.`,
      })
      .run()
  })
  .apply(bookingCheckedInEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(bookingActivityRows)
      .values({
        bookingId: payload.bookingId,
        kind: 'bookingCheckedIn',
        message: `${payload.checkedInByEmail} checked in.`,
      })
      .run()
  })
  .apply(roomReleasedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(bookingActivityRows)
      .values({
        bookingId: payload.bookingId,
        kind: 'roomReleased',
        message: `${payload.releasedByEmail} released the room early.`,
      })
      .run()
  })
  .apply(approvalNotificationRecordedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(bookingActivityRows)
      .values({
        bookingId: payload.bookingId,
        kind: 'approvalNotificationRecorded',
        message: payload.message,
      })
      .run()
  })
  .handle(async (_query, db) =>
    (await db.select().from(bookingActivityRows).all()).reverse().slice(0, 12),
  )

export default bookingActivityQuery
