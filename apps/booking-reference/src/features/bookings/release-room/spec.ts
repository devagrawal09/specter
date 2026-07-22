import { createCommandSlice, event } from '@specter-ts/spec'
export default createCommandSlice('releaseRoom')
  .description('Releases rooms from checked-in bookings.')
  .scenarios(
    {
      description: 'Releases a checked-in booking early.',
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
      when: { bookingId: 'booking-1', releasedByEmail: 'ada@example.com' },
      expect: [
        event('room-released', {
          bookingId: 'booking-1',
          releasedByEmail: 'ada@example.com',
        }),
      ],
    },
    {
      description: 'Rejects releasing a missing booking.',
      given: [],
      when: { bookingId: 'missing', releasedByEmail: 'ada@example.com' },
      expect: [],
      reject: { reason: 'Booking not found' },
    },
    {
      description: 'Rejects releasing an already released booking.',
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
        event('room-released', {
          bookingId: 'booking-1',
          releasedByEmail: 'ada@example.com',
        }),
      ],
      when: { bookingId: 'booking-1', releasedByEmail: 'ada@example.com' },
      expect: [],
      reject: { reason: 'Only checked-in bookings can be released' },
    },
  )
