import { createCommandSlice, event } from '@specter-ts/spec'
export default createCommandSlice('checkInBooking')
  .description('Checks approved bookings into their room.')
  .scenarios(
    {
      description: 'Checks in an approved booking.',
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
      ],
      when: { bookingId: 'booking-1', checkedInByEmail: 'ada@example.com' },
      expect: [
        event('booking-checked-in', {
          bookingId: 'booking-1',
          checkedInByEmail: 'ada@example.com',
        }),
      ],
    },
    {
      description: 'Rejects checking in a missing booking.',
      given: [],
      when: { bookingId: 'missing', checkedInByEmail: 'ada@example.com' },
      expect: [],
      reject: { reason: 'Booking not found' },
    },
    {
      description: 'Rejects checking in an already checked-in booking.',
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
        event('booking-checked-in', {
          bookingId: 'booking-1',
          checkedInByEmail: 'ada@example.com',
        }),
      ],
      when: { bookingId: 'booking-1', checkedInByEmail: 'ada@example.com' },
      expect: [],
      reject: { reason: 'Only approved bookings can be checked in' },
    },
  )
