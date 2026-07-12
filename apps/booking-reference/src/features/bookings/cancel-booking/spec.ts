import { createCommandSlice, event } from '@specter-ts/core/spec'
export default createCommandSlice('cancelBooking')
  .description('Cancels pending or approved bookings.')
  .scenarios(
    {
      description: 'Cancels an existing booking with a reason.',
      given: [
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
        canceledByEmail: 'ada@example.com',
        reason: 'No longer needed',
      },
      expect: [
        event('booking-canceled', {
          bookingId: 'booking-1',
          canceledByEmail: 'ada@example.com',
          reason: 'No longer needed',
        }),
      ],
    },
    {
      description: 'Rejects canceling a missing booking.',
      given: [],
      when: {
        bookingId: 'missing',
        canceledByEmail: 'ada@example.com',
        reason: 'Nope',
      },
      expect: [],
      reject: { reason: 'Booking not found' },
    },
    {
      description: 'Rejects canceling an already canceled booking.',
      given: [
        event('booking-requested', {
          bookingId: 'booking-1',
          roomId: 'room-1',
          requesterEmail: 'ada@example.com',
          requesterName: 'Ada',
          purpose: 'Planning',
          startsAt: '2026-06-01T09:00:00.000Z',
          endsAt: '2026-06-01T10:00:00.000Z',
        }),
        event('booking-approved', {
          bookingId: 'booking-1',
          approverEmail: 'lin@example.com',
          approverName: 'Lin',
        }),
        event('booking-canceled', {
          bookingId: 'booking-1',
          canceledByEmail: 'ada@example.com',
          reason: 'No longer needed',
        }),
      ],
      when: {
        bookingId: 'booking-1',
        canceledByEmail: 'ada@example.com',
        reason: 'Again',
      },
      expect: [],
      reject: { reason: 'Only pending or approved bookings can be canceled' },
    },
  )
