import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import spec from './spec'
import { sqliteSliceStore } from '../../../db/specter-sqlite'
import { activeBookingStatuses } from '../booking-state'
import {
  bookingRequestedEvent,
  roomCreatedEvent,
  roomRetiredEvent,
} from '../events'

export const retireRoomSqlRooms = sqliteTable('retire_room_sql_rooms', {
  roomId: text('room_id').primaryKey(),
  name: text('name').notNull(),
  capacity: integer('capacity').notNull(),
  location: text('location').notNull(),
  retired: integer('retired', { mode: 'boolean' }).notNull().default(false),
})

export const retireRoomSqlBookings = sqliteTable('retire_room_sql_bookings', {
  bookingId: text('booking_id').primaryKey(),
  roomId: text('room_id').notNull(),
  requesterEmail: text('requester_email').notNull(),
  requesterName: text('requester_name').notNull(),
  purpose: text('purpose').notNull(),
  startsAt: text('starts_at').notNull(),
  endsAt: text('ends_at').notNull(),
  status: text('status').notNull(),
})

const retireRoom = spec
  .inputSchema(z.object({ roomId: z.string().min(1) }))
  .store(sqliteSliceStore)
  .apply(roomCreatedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(retireRoomSqlRooms)
      .values({ ...payload, retired: false })
      .run()
  })
  .apply(roomRetiredEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(retireRoomSqlRooms)
      .set({ retired: true })
      .where(eq(retireRoomSqlRooms.roomId, payload.roomId))
      .run()
  })
  .apply(bookingRequestedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(retireRoomSqlBookings)
      .values({ ...payload, status: 'pending' })
      .run()
  })
  .handle(async (command, db) => {
    const room = (
      await db
        .select()
        .from(retireRoomSqlRooms)
        .where(eq(retireRoomSqlRooms.roomId, command.roomId))
        .all()
    )[0]
    if (!room) throw new Error('Room not found')
    if (room.retired) throw new Error('Room is already retired')
    const activeBookings = (
      await db
        .select()
        .from(retireRoomSqlBookings)
        .where(eq(retireRoomSqlBookings.roomId, command.roomId))
        .all()
    ).filter((booking) => activeBookingStatuses.includes(booking.status))
    if (activeBookings.length > 0) throw new Error('Room has active bookings')
    return [roomRetiredEvent.create({ roomId: command.roomId })]
  })

export default retireRoom
