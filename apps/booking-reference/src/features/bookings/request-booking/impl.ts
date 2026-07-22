import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
import { sqliteSliceStore } from '../../../db/specter-store'
import { activeBookingStatuses, overlaps } from '../booking-state'
import {
  bookingRequestedEvent,
  roomCreatedEvent,
  roomRetiredEvent,
} from '../events'

export const requestBookingSqlRooms = sqliteTable('request_booking_sql_rooms', {
  roomId: text('room_id').primaryKey(),
  name: text('name').notNull(),
  capacity: integer('capacity').notNull(),
  location: text('location').notNull(),
  retired: integer('retired', { mode: 'boolean' }).notNull().default(false),
})

export const requestBookingSqlBookings = sqliteTable(
  'request_booking_sql_bookings',
  {
    bookingId: text('booking_id').primaryKey(),
    roomId: text('room_id').notNull(),
    requesterEmail: text('requester_email').notNull(),
    requesterName: text('requester_name').notNull(),
    purpose: text('purpose').notNull(),
    startsAt: text('starts_at').notNull(),
    endsAt: text('ends_at').notNull(),
    status: text('status').notNull(),
  },
)

const requestBooking = implementCommand(specification)
  .inputSchema(
    z.object({
      bookingId: z.string().min(1),
      roomId: z.string().min(1),
      requesterEmail: z.string().email(),
      requesterName: z.string(),
      purpose: z.string(),
      startsAt: z.string(),
      endsAt: z.string(),
    }),
  )
  .store(sqliteSliceStore)
  .apply(roomCreatedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(requestBookingSqlRooms)
      .values({ ...payload, retired: false })
      .onConflictDoNothing()
      .run()
  })
  .apply(roomRetiredEvent, async (event, db) => {
    const payload = event.payload
    await db
      .update(requestBookingSqlRooms)
      .set({ retired: true })
      .where(eq(requestBookingSqlRooms.roomId, payload.roomId))
      .run()
  })
  .apply(bookingRequestedEvent, async (event, db) => {
    const payload = event.payload
    await db
      .insert(requestBookingSqlBookings)
      .values({ ...payload, status: 'pending' })
      .onConflictDoNothing()
      .run()
  })
  .handle(async (command, db) => {
    const requesterName = command.requesterName.trim()
    const purpose = command.purpose.trim()
    if (!requesterName) throw new Error('Requester name is required')
    if (!purpose) throw new Error('Booking purpose is required')
    if (command.startsAt >= command.endsAt)
      throw new Error('Booking start must be before end')

    const room = (
      await db
        .select()
        .from(requestBookingSqlRooms)
        .where(eq(requestBookingSqlRooms.roomId, command.roomId))
        .all()
    )[0]
    if (!room || room.retired) throw new Error('Room is not available')

    const conflicting = (
      await db
        .select()
        .from(requestBookingSqlBookings)
        .where(eq(requestBookingSqlBookings.roomId, command.roomId))
        .all()
    ).find(
      (booking) =>
        activeBookingStatuses.includes(booking.status) &&
        overlaps(
          booking.startsAt,
          booking.endsAt,
          command.startsAt,
          command.endsAt,
        ),
    )
    if (conflicting) throw new Error('Room is already held for that time')

    return [
      bookingRequestedEvent.create({
        ...command,
        bookingId: command.bookingId,
        requesterName,
        purpose,
      }),
    ]
  })

export default requestBooking
