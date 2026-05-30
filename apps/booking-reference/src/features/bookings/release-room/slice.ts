import { eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createCommandSlice } from '@specter-ts/core'
import { sqliteSliceStore } from '../../../db/specter-sqlite'
import {
  bookingApprovedEvent,
  bookingCheckedInEvent,
  bookingRequestedEvent,
  roomReleasedEvent,
} from '../events'

export const releaseRoomSqlBookings = sqliteTable('release_room_sql_bookings', {
  bookingId: text('booking_id').primaryKey(),
  roomId: text('room_id').notNull(),
  requesterEmail: text('requester_email').notNull(),
  requesterName: text('requester_name').notNull(),
  purpose: text('purpose').notNull(),
  startsAt: text('starts_at').notNull(),
  endsAt: text('ends_at').notNull(),
  status: text('status').notNull(),
})

const releaseRoom = createCommandSlice('releaseRoom')
  .schema(
    z.object({
      bookingId: z.string().min(1),
      releasedByEmail: z.string().email(),
    }),
  )
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
        bookingCheckedInEvent.create({
          bookingId: 'booking-1',
          checkedInByEmail: 'ada@example.com',
        }),
      ],
      when: { bookingId: 'booking-1', releasedByEmail: 'ada@example.com' },
      expect: [
        roomReleasedEvent.create({
          bookingId: 'booking-1',
          releasedByEmail: 'ada@example.com',
        }),
      ],
    },
    {
      given: [],
      when: { bookingId: 'missing', releasedByEmail: 'ada@example.com' },
      expect: [],
      reject: { reason: 'Booking not found' },
    },
  )
  .apply({
    [bookingRequestedEvent.type]: async (event, db) => {
      const payload = await bookingRequestedEvent.decode(event.payload)
      db.insert(releaseRoomSqlBookings)
        .values({ ...payload, status: 'pending' })
        .run()
    },
    [bookingApprovedEvent.type]: async (event, db) => {
      const payload = await bookingApprovedEvent.decode(event.payload)
      db.update(releaseRoomSqlBookings)
        .set({ status: 'approved' })
        .where(eq(releaseRoomSqlBookings.bookingId, payload.bookingId))
        .run()
    },
    [bookingCheckedInEvent.type]: async (event, db) => {
      const payload = await bookingCheckedInEvent.decode(event.payload)
      db.update(releaseRoomSqlBookings)
        .set({ status: 'checkedIn' })
        .where(eq(releaseRoomSqlBookings.bookingId, payload.bookingId))
        .run()
    },
    [roomReleasedEvent.type]: async (event, db) => {
      const payload = await roomReleasedEvent.decode(event.payload)
      db.update(releaseRoomSqlBookings)
        .set({ status: 'released' })
        .where(eq(releaseRoomSqlBookings.bookingId, payload.bookingId))
        .run()
    },
  })
  .handle(async (command, db) => {
    const booking = db
      .select()
      .from(releaseRoomSqlBookings)
      .where(eq(releaseRoomSqlBookings.bookingId, command.bookingId))
      .all()[0]
    if (!booking) throw new Error('Booking not found')
    if (booking.status !== 'checkedIn')
      throw new Error('Only checked-in bookings can be released')
    return [roomReleasedEvent.create(command)]
  })

export default releaseRoom
