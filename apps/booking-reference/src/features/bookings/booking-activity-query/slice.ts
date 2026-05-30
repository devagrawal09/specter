import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createQuerySlice } from '@specter-ts/core'
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

const bookingActivityQuery = createQuerySlice('bookingActivityQuery')
  .schema(z.object({}))
  .store(sqliteSliceStore)
  .apply({
    [roomCreatedEvent.type]: async (event, db) => {
      const payload = await roomCreatedEvent.decode(event.payload)
      db.insert(bookingActivityRows)
        .values({
          roomId: payload.roomId,
          kind: 'roomCreated',
          message: `Room ${payload.name} opened on ${payload.location}.`,
        })
        .run()
    },
    [roomRetiredEvent.type]: async (event, db) => {
      const payload = await roomRetiredEvent.decode(event.payload)
      db.insert(bookingActivityRows)
        .values({
          roomId: payload.roomId,
          kind: 'roomRetired',
          message: `Room ${payload.roomId} was retired.`,
        })
        .run()
    },
    [bookingRequestedEvent.type]: async (event, db) => {
      const payload = await bookingRequestedEvent.decode(event.payload)
      db.insert(bookingActivityRows)
        .values({
          bookingId: payload.bookingId,
          roomId: payload.roomId,
          kind: 'bookingRequested',
          message: `${payload.requesterName} requested ${payload.purpose}.`,
        })
        .run()
    },
    [bookingApprovedEvent.type]: async (event, db) => {
      const payload = await bookingApprovedEvent.decode(event.payload)
      db.insert(bookingActivityRows)
        .values({
          bookingId: payload.bookingId,
          kind: 'bookingApproved',
          message: `${payload.approverName} approved booking ${payload.bookingId}.`,
        })
        .run()
    },
    [bookingRejectedEvent.type]: async (event, db) => {
      const payload = await bookingRejectedEvent.decode(event.payload)
      db.insert(bookingActivityRows)
        .values({
          bookingId: payload.bookingId,
          kind: 'bookingRejected',
          message: `${payload.approverName} rejected booking ${payload.bookingId}: ${payload.reason}.`,
        })
        .run()
    },
    [bookingRescheduledEvent.type]: async (event, db) => {
      const payload = await bookingRescheduledEvent.decode(event.payload)
      db.insert(bookingActivityRows)
        .values({
          bookingId: payload.bookingId,
          roomId: payload.roomId,
          kind: 'bookingRescheduled',
          message: `Booking ${payload.bookingId} moved to ${payload.startsAt}.`,
        })
        .run()
    },
    [bookingCanceledEvent.type]: async (event, db) => {
      const payload = await bookingCanceledEvent.decode(event.payload)
      db.insert(bookingActivityRows)
        .values({
          bookingId: payload.bookingId,
          kind: 'bookingCanceled',
          message: `Booking ${payload.bookingId} was canceled: ${payload.reason}.`,
        })
        .run()
    },
    [bookingCheckedInEvent.type]: async (event, db) => {
      const payload = await bookingCheckedInEvent.decode(event.payload)
      db.insert(bookingActivityRows)
        .values({
          bookingId: payload.bookingId,
          kind: 'bookingCheckedIn',
          message: `${payload.checkedInByEmail} checked in.`,
        })
        .run()
    },
    [roomReleasedEvent.type]: async (event, db) => {
      const payload = await roomReleasedEvent.decode(event.payload)
      db.insert(bookingActivityRows)
        .values({
          bookingId: payload.bookingId,
          kind: 'roomReleased',
          message: `${payload.releasedByEmail} released the room early.`,
        })
        .run()
    },
    [approvalNotificationRecordedEvent.type]: async (event, db) => {
      const payload = await approvalNotificationRecordedEvent.decode(
        event.payload,
      )
      db.insert(bookingActivityRows)
        .values({
          bookingId: payload.bookingId,
          kind: 'approvalNotificationRecorded',
          message: payload.message,
        })
        .run()
    },
  })
  .scenarios({
    given: [
      roomCreatedEvent.create({
        roomId: 'room-1',
        name: 'Library',
        capacity: 6,
        location: 'Floor 1',
      }),
    ],
    when: {},
    expect: [
      {
        id: 1,
        bookingId: null,
        roomId: 'room-1',
        kind: 'roomCreated',
        message: 'Room Library opened on Floor 1.',
      },
    ],
  })
  .handle(async (_query, db) =>
    db.select().from(bookingActivityRows).all().reverse().slice(0, 12),
  )

export default bookingActivityQuery
