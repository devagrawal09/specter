import { createCommandSlice, event } from '@specter-ts/spec'
export default createCommandSlice('approveBooking')
  .description('Approves pending booking requests.')
  .scenarios(
    {
      description: 'Approves a pending booking by another user.',
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
      },
      expect: [
        event('booking-approved', {
          bookingId: 'booking-1',
          approverEmail: 'lin@example.com',
          approverName: 'Lin',
        }),
      ],
    },
    {
      description: 'Rejects self-approval by the requester.',
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
        approverEmail: 'ada@example.com',
        approverName: 'Ada',
      },
      expect: [],
      reject: { reason: 'Requester cannot approve their own booking' },
    },
    {
      description: 'Rejects approving an already approved booking.',
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
      when: {
        bookingId: 'booking-1',
        approverEmail: 'grace@example.com',
        approverName: 'Grace',
      },
      expect: [],
      reject: { reason: 'Only pending bookings can be approved' },
    },
  )
