import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createCommandSlice } from '@specter-ts/core'
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

const retireRoom = createCommandSlice('retireRoom')
  .schema(z.object({ roomId: z.string().min(1) }))
  .store(sqliteSliceStore)
  .scenarios(
    {
      given: [
        roomCreatedEvent.create({
          roomId: 'room-1',
          name: 'Boardroom',
          capacity: 10,
          location: 'Floor 2',
        }),
      ],
      when: { roomId: 'room-1' },
      expect: [roomRetiredEvent.create({ roomId: 'room-1' })],
    },
    {
      given: [],
      when: { roomId: 'missing' },
      expect: [],
      reject: { reason: 'Room not found' },
    },
  )
  .apply({
    [roomCreatedEvent.type]: async (event, db) => {
      const payload = await roomCreatedEvent.decode(event.payload)
      db.insert(retireRoomSqlRooms)
        .values({ ...payload, retired: false })
        .run()
    },
    [roomRetiredEvent.type]: async (event, db) => {
      const payload = await roomRetiredEvent.decode(event.payload)
      db.update(retireRoomSqlRooms)
        .set({ retired: true })
        .where(eq(retireRoomSqlRooms.roomId, payload.roomId))
        .run()
    },
    [bookingRequestedEvent.type]: async (event, db) => {
      const payload = await bookingRequestedEvent.decode(event.payload)
      db.insert(retireRoomSqlBookings)
        .values({ ...payload, status: 'pending' })
        .run()
    },
  })
  .handle(async (command, db) => {
    const room = db
      .select()
      .from(retireRoomSqlRooms)
      .where(eq(retireRoomSqlRooms.roomId, command.roomId))
      .all()[0]
    if (!room) throw new Error('Room not found')
    if (room.retired) throw new Error('Room is already retired')
    const activeBookings = db
      .select()
      .from(retireRoomSqlBookings)
      .where(eq(retireRoomSqlBookings.roomId, command.roomId))
      .all()
      .filter((booking) => activeBookingStatuses.includes(booking.status))
    if (activeBookings.length > 0) throw new Error('Room has active bookings')
    return [roomRetiredEvent.create({ roomId: command.roomId })]
  })

export default retireRoom
