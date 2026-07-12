import { createCommandSlice, event } from '@specter-ts/core/spec'
export default createCommandSlice('rejectBooking')
  .description('Rejects pending booking requests.')
  .scenarios(
    {
      description: 'Rejects a pending booking with a reason.',
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
        approverEmail: 'lin@example.com',
        approverName: 'Lin',
        reason: 'Too small',
      },
      expect: [
        event('booking-rejected', {
          bookingId: 'booking-1',
          approverEmail: 'lin@example.com',
          approverName: 'Lin',
          reason: 'Too small',
        }),
      ],
    },
    {
      description: 'Rejects a rejection for a missing booking.',
      given: [],
      when: {
        bookingId: 'missing',
        approverEmail: 'lin@example.com',
        approverName: 'Lin',
        reason: 'Nope',
      },
      expect: [],
      reject: { reason: 'Booking not found' },
    },
    {
      description: 'Rejects rejecting an already rejected booking.',
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
        event('booking-rejected', {
          bookingId: 'booking-1',
          approverEmail: 'lin@example.com',
          approverName: 'Lin',
          reason: 'Too small',
        }),
      ],
      when: {
        bookingId: 'booking-1',
        approverEmail: 'grace@example.com',
        approverName: 'Grace',
        reason: 'Still too small',
      },
      expect: [],
      reject: { reason: 'Only pending bookings can be rejected' },
    },
  )
