import { createCommandSlice, event } from '@specter-ts/core/spec'

export default createCommandSlice('recordApprovalNotification')
  .description('Records notifications for approved bookings.')
  .scenarios(
    {
      description: 'Records a notification for an approved booking.',
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
      when: { bookingId: 'booking-1' },
      expect: [
        event('approval-notification-recorded', {
          bookingId: 'booking-1',
          message: "Ada's booking for Planning was approved.",
        }),
      ],
    },
    {
      description: 'Rejects notification recording for a missing booking.',
      given: [],
      when: { bookingId: 'missing' },
      expect: [],
      reject: { reason: 'Booking not found' },
    },
  )
