import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createCommandSlice } from '@specter-ts/core'
import { sqliteSliceStore } from '../../../db/specter-sqlite'
import { roomCreatedEvent, roomRetiredEvent } from '../events'

export const createRoomSqlRooms = sqliteTable('create_room_sql_rooms', {
  roomId: text('room_id').primaryKey(),
  name: text('name').notNull(),
  capacity: integer('capacity').notNull(),
  location: text('location').notNull(),
  retired: integer('retired', { mode: 'boolean' }).notNull().default(false),
})

const createRoom = createCommandSlice('createRoom', 'Creates meeting rooms.')
  .schema(
    z.object({
      name: z.string(),
      capacity: z.number().int().positive(),
      location: z.string(),
    }),
  )
  .store(sqliteSliceStore)
  .scenarios(
    {
      description: 'Creates a room with a unique name.',
      given: [],
      when: { name: 'Boardroom', capacity: 10, location: 'Floor 2' },
      expect: [
        roomCreatedEvent.create({
          roomId: 'generated',
          name: 'Boardroom',
          capacity: 10,
          location: 'Floor 2',
        }),
      ],
    },
    {
      description: 'Rejects a room name that is already active.',
      given: [
        roomCreatedEvent.create({
          roomId: 'room-1',
          name: 'Boardroom',
          capacity: 10,
          location: 'Floor 2',
        }),
      ],
      when: { name: 'Boardroom', capacity: 8, location: 'Floor 3' },
      expect: [],
      reject: { reason: 'Room name is already in use' },
    },
  )
  .apply({
    [roomCreatedEvent.type]: async (event, db) => {
      const payload = await roomCreatedEvent.decode(event.payload)
      await db
        .insert(createRoomSqlRooms)
        .values({ ...payload, retired: false })
        .run()
    },
    [roomRetiredEvent.type]: async (event, db) => {
      const payload = await roomRetiredEvent.decode(event.payload)
      await db
        .update(createRoomSqlRooms)
        .set({ retired: true })
        .where(eq(createRoomSqlRooms.roomId, payload.roomId))
        .run()
    },
  })
  .handle(async (command, db) => {
    const name = command.name.trim()
    const location = command.location.trim()

    if (!name) throw new Error('Room name is required')
    if (!location) throw new Error('Room location is required')

    const existing = (
      await db
        .select()
        .from(createRoomSqlRooms)
        .where(eq(createRoomSqlRooms.name, name))
        .all()
    )[0]

    if (existing && !existing.retired)
      throw new Error('Room name is already in use')

    return [
      roomCreatedEvent.create({
        roomId: crypto.randomUUID(),
        name,
        capacity: command.capacity,
        location,
      }),
    ]
  })

export default createRoom
