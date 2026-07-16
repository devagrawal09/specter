import { eq } from 'drizzle-orm'
import { sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import spec from './spec'
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

const releaseRoom = spec
  .inputSchema(
    z.object({
      bookingId: z.string().min(1),
      releasedByEmail: z.string().email(),
    }),
  )
  .store(sqliteSliceStore)
  .apply(bookingRequestedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(releaseRoomSqlBookings)
      .values({ ...payload, status: 'pending' })
      .onConflictDoNothing()
      .run()
  })
  .apply(bookingApprovedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(releaseRoomSqlBookings)
      .set({ status: 'approved' })
      .where(eq(releaseRoomSqlBookings.bookingId, payload.bookingId))
      .run()
  })
  .apply(bookingCheckedInEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(releaseRoomSqlBookings)
      .set({ status: 'checkedIn' })
      .where(eq(releaseRoomSqlBookings.bookingId, payload.bookingId))
      .run()
  })
  .apply(roomReleasedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(releaseRoomSqlBookings)
      .set({ status: 'released' })
      .where(eq(releaseRoomSqlBookings.bookingId, payload.bookingId))
      .run()
  })
  .handle(async (command, db) => {
    const booking = (
      await db
        .select()
        .from(releaseRoomSqlBookings)
        .where(eq(releaseRoomSqlBookings.bookingId, command.bookingId))
        .all()
    )[0]
    if (!booking) throw new Error('Booking not found')
    if (booking.status !== 'checkedIn')
      throw new Error('Only checked-in bookings can be released')
    return [roomReleasedEvent.create(command)]
  })

export default releaseRoom
