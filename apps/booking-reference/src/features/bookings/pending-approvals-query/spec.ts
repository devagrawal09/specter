import { createQuerySlice, event } from '@specter-ts/core/spec'
export default createQuerySlice('pendingApprovalsQuery')
  .description('Lists bookings still awaiting approval.')
  .scenarios(
    {
      description: 'Returns pending booking requests.',
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
      when: {},
      expect: [
        {
          bookingId: 'booking-1',
          roomId: 'room-1',
          requesterEmail: 'ada@example.com',
          requesterName: 'Ada',
          purpose: 'Planning',
          startsAt: '2026-06-01T09:00:00.000Z',
          endsAt: '2026-06-01T10:00:00.000Z',
          status: 'pending',
        },
      ],
    },
    {
      description: 'Excludes completed approval decisions and cancellations.',
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
        event('booking-requested', {
          bookingId: 'booking-2',
          roomId: 'room-1',
          requesterEmail: 'ada@example.com',
          requesterName: 'Ada',
          purpose: 'Planning',
          startsAt: '2026-06-01T09:00:00.000Z',
          endsAt: '2026-06-01T10:00:00.000Z',
        }),
        event('booking-rejected', {
          bookingId: 'booking-2',
          approverEmail: 'lin@example.com',
          approverName: 'Lin',
          reason: 'No',
        }),
        event('booking-requested', {
          bookingId: 'booking-3',
          roomId: 'room-1',
          requesterEmail: 'ada@example.com',
          requesterName: 'Ada',
          purpose: 'Planning',
          startsAt: '2026-06-01T09:00:00.000Z',
          endsAt: '2026-06-01T10:00:00.000Z',
        }),
        event('booking-canceled', {
          bookingId: 'booking-3',
          canceledByEmail: 'ada@example.com',
          reason: 'Changed plans',
        }),
      ],
      when: {},
      expect: [],
    },
  )
