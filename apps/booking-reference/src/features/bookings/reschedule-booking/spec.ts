import { createCommandSlice, event } from '@specter-ts/core/spec'
export default createCommandSlice('rescheduleBooking')
  .description('Moves bookings to another available time.')
  .scenarios(
    {
      description: 'Reschedules a booking into an available time.',
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
        bookingId: 'booking-1',
        roomId: 'room-1',
        startsAt: '2026-06-01T10:00:00.000Z',
        endsAt: '2026-06-01T11:00:00.000Z',
      },
      expect: [
        event('booking-rescheduled', {
          bookingId: 'booking-1',
          roomId: 'room-1',
          startsAt: '2026-06-01T10:00:00.000Z',
          endsAt: '2026-06-01T11:00:00.000Z',
        }),
      ],
    },
    {
      description: 'Rejects rescheduling a missing booking.',
      given: [],
      when: {
        bookingId: 'missing',
        roomId: 'room-1',
        startsAt: '2026-06-01T10:00:00.000Z',
        endsAt: '2026-06-01T11:00:00.000Z',
      },
      expect: [],
      reject: { reason: 'Booking not found' },
    },
    {
      description:
        'Covers inactive, retired, and previously rescheduled state.',
      given: [
        event('room-created', {
          roomId: 'room-1',
          name: 'Library',
          capacity: 6,
          location: 'Floor 1',
        }),
        event('room-created', {
          roomId: 'room-2',
          name: 'Studio',
          capacity: 4,
          location: 'Floor 3',
        }),
        event('room-retired', { roomId: 'room-2' }),
        event('booking-requested', {
          bookingId: 'booking-1',
          roomId: 'room-1',
          requesterEmail: 'ada@example.com',
          requesterName: 'Ada',
          purpose: 'Planning',
          startsAt: '2026-06-01T09:00:00.000Z',
          endsAt: '2026-06-01T10:00:00.000Z',
        }),
        event('booking-rejected', {
          bookingId: 'booking-1',
          approverEmail: 'lin@example.com',
          approverName: 'Lin',
          reason: 'No',
        }),
        event('booking-requested', {
          bookingId: 'booking-2',
          roomId: 'room-1',
          requesterEmail: 'lin@example.com',
          requesterName: 'Lin',
          purpose: 'Review',
          startsAt: '2026-06-01T11:00:00.000Z',
          endsAt: '2026-06-01T12:00:00.000Z',
        }),
        event('booking-canceled', {
          bookingId: 'booking-2',
          canceledByEmail: 'lin@example.com',
          reason: 'Changed plans',
        }),
        event('booking-requested', {
          bookingId: 'booking-3',
          roomId: 'room-1',
          requesterEmail: 'grace@example.com',
          requesterName: 'Grace',
          purpose: 'Retro',
          startsAt: '2026-06-01T12:00:00.000Z',
          endsAt: '2026-06-01T13:00:00.000Z',
        }),
        event('booking-rescheduled', {
          bookingId: 'booking-3',
          roomId: 'room-1',
          startsAt: '2026-06-01T13:00:00.000Z',
          endsAt: '2026-06-01T14:00:00.000Z',
        }),
      ],
      when: {
        bookingId: 'missing',
        roomId: 'room-2',
        startsAt: '2026-06-01T10:00:00.000Z',
        endsAt: '2026-06-01T11:00:00.000Z',
      },
      expect: [],
      reject: { reason: 'Booking not found' },
    },
  )
