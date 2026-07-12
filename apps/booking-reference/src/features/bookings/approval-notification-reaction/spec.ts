import { createReactionSlice, event } from '@specter-ts/core/spec'
export default createReactionSlice('approvalNotificationReaction')
  .description(
    'Requests approval notification recording after booking approval.',
  )
  .scenarios(
    {
      description: 'Requests notification recording for an approved booking.',
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
      expect: [
        {
          type: 'recordApprovalNotification',
          payload: { bookingId: 'booking-1' },
        },
      ],
    },
    {
      description: 'Does not request notification recording twice.',
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
        event('approval-notification-recorded', {
          bookingId: 'booking-1',
          message: "Ada's booking for Planning was approved.",
        }),
      ],
      expect: [],
    },
  )
