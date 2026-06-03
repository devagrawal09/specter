import { eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createCommandSlice } from '@specter-ts/core'
import { sqliteSliceStore } from '../../../db/specter-sqlite'
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

const requestBooking = createCommandSlice(
  'requestBooking',
  'Requests a room booking for approval.',
)
  .schema(
    z.object({
      roomId: z.string().min(1),
      requesterEmail: z.string().email(),
      requesterName: z.string(),
      purpose: z.string(),
      startsAt: z.string(),
      endsAt: z.string(),
    }),
  )
  .store(sqliteSliceStore)
  .scenarios(
    {
      description: 'Requests a booking for an available room.',
      given: [
        roomCreatedEvent.create({
          roomId: 'room-1',
          name: 'Library',
          capacity: 6,
          location: 'Floor 1',
        }),
      ],
      when: {
        roomId: 'room-1',
        requesterEmail: 'ada@example.com',
        requesterName: 'Ada',
        purpose: 'Planning',
        startsAt: '2026-06-01T09:00:00.000Z',
        endsAt: '2026-06-01T10:00:00.000Z',
      },
      expect: [
        bookingRequestedEvent.create({
          bookingId: 'generated',
          roomId: 'room-1',
          requesterEmail: 'ada@example.com',
          requesterName: 'Ada',
          purpose: 'Planning',
          startsAt: '2026-06-01T09:00:00.000Z',
          endsAt: '2026-06-01T10:00:00.000Z',
        }),
      ],
    },
    {
      description: 'Rejects a booking that overlaps an active booking.',
      given: [
        roomCreatedEvent.create({
          roomId: 'room-1',
          name: 'Library',
          capacity: 6,
          location: 'Floor 1',
        }),
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
      when: {
        roomId: 'room-1',
        requesterEmail: 'lin@example.com',
        requesterName: 'Lin',
        purpose: 'Review',
        startsAt: '2026-06-01T09:30:00.000Z',
        endsAt: '2026-06-01T10:30:00.000Z',
      },
      expect: [],
      reject: { reason: 'Room is already held for that time' },
    },
  )
  .apply({
    [roomCreatedEvent.type]: async (event, db) => {
      const payload = await roomCreatedEvent.decode(event.payload)
      await db
        .insert(requestBookingSqlRooms)
        .values({ ...payload, retired: false })
        .run()
    },
    [roomRetiredEvent.type]: async (event, db) => {
      const payload = await roomRetiredEvent.decode(event.payload)
      await db
        .update(requestBookingSqlRooms)
        .set({ retired: true })
        .where(eq(requestBookingSqlRooms.roomId, payload.roomId))
        .run()
    },
    [bookingRequestedEvent.type]: async (event, db) => {
      const payload = await bookingRequestedEvent.decode(event.payload)
      await db
        .insert(requestBookingSqlBookings)
        .values({ ...payload, status: 'pending' })
        .run()
    },
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
        bookingId: crypto.randomUUID(),
        requesterName,
        purpose,
      }),
    ]
  })

export default requestBooking
