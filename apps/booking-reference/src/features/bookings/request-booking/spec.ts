import { createCommandSlice, event } from '@specter-ts/core/spec'
export default createCommandSlice('requestBooking')
  .description('Requests a room booking for approval.')
  .scenarios(
    {
      description: 'Requests a booking for an available room.',
      given: [
        event('room-created', {
          roomId: 'room-1',
          name: 'Library',
          capacity: 6,
          location: 'Floor 1',
        }),
      ],
      when: {
        bookingId: 'booking-1',
        roomId: 'room-1',
        requesterEmail: 'ada@example.com',
        requesterName: 'Ada',
        purpose: 'Planning',
        startsAt: '2026-06-01T09:00:00.000Z',
        endsAt: '2026-06-01T10:00:00.000Z',
      },
      expect: [
        event('booking-requested', {
          bookingId: 'booking-1',
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
        event('room-created', {
          roomId: 'room-1',
          name: 'Library',
          capacity: 6,
          location: 'Floor 1',
        }),
        event('booking-requested', {
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
        bookingId: 'booking-2',
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
    {
      description: 'Rejects a booking for a retired room.',
      given: [
        event('room-created', {
          roomId: 'room-1',
          name: 'Library',
          capacity: 6,
          location: 'Floor 1',
        }),
        event('room-retired', { roomId: 'room-1' }),
      ],
      when: {
        bookingId: 'booking-2',
        roomId: 'room-1',
        requesterEmail: 'lin@example.com',
        requesterName: 'Lin',
        purpose: 'Review',
        startsAt: '2026-06-01T10:00:00.000Z',
        endsAt: '2026-06-01T11:00:00.000Z',
      },
      expect: [],
      reject: { reason: 'Room is not available' },
    },
  )
