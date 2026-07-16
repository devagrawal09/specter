import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import spec from './spec'
import { sqliteSliceStore } from '../../../db/specter-sqlite'
import { roomCreatedEvent, roomRetiredEvent } from '../events'

export const createRoomSqlRooms = sqliteTable('create_room_sql_rooms', {
  roomId: text('room_id').primaryKey(),
  name: text('name').notNull(),
  capacity: integer('capacity').notNull(),
  location: text('location').notNull(),
  retired: integer('retired', { mode: 'boolean' }).notNull().default(false),
})

const createRoom = spec
  .inputSchema(
    z.object({
      roomId: z.string().min(1),
      name: z.string(),
      capacity: z.number().int().positive(),
      location: z.string(),
    }),
  )
  .store(sqliteSliceStore)
  .apply(roomCreatedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(createRoomSqlRooms)
      .values({ ...payload, retired: false })
      .onConflictDoNothing()
      .run()
  })
  .apply(roomRetiredEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(createRoomSqlRooms)
      .set({ retired: true })
      .where(eq(createRoomSqlRooms.roomId, payload.roomId))
      .run()
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
        roomId: command.roomId,
        name,
        capacity: command.capacity,
        location,
      }),
    ]
  })

export default createRoom
