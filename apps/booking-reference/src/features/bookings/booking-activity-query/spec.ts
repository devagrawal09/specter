import { createQuerySlice, event } from '@specter-ts/core/spec'

export default createQuerySlice('bookingActivityQuery')
  .description('Shows recent booking and room activity.')
  .scenarios(
    {
      description: 'Returns activity rows created from room events.',
      given: [
        event('room-created', {
          roomId: 'room-1',
          name: 'Library',
          capacity: 6,
          location: 'Floor 1',
        }),
      ],
      when: {},
      expect: [
        {
          id: 1,
          bookingId: null,
          roomId: 'room-1',
          kind: 'roomCreated',
          message: 'Room Library opened on Floor 1.',
        },
      ],
    },
    {
      description: 'Records the complete booking lifecycle in reverse order.',
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
        event('booking-approved', {
          bookingId: 'booking-1',
          approverEmail: 'lin@example.com',
          approverName: 'Lin',
        }),
        event('booking-rejected', {
          bookingId: 'booking-1',
          approverEmail: 'lin@example.com',
          approverName: 'Lin',
          reason: 'No',
        }),
        event('booking-rescheduled', {
          bookingId: 'booking-1',
          roomId: 'room-1',
          startsAt: '2026-06-01T10:00:00.000Z',
          endsAt: '2026-06-01T11:00:00.000Z',
        }),
        event('booking-canceled', {
          bookingId: 'booking-1',
          canceledByEmail: 'ada@example.com',
          reason: 'Changed plans',
        }),
        event('booking-checked-in', {
          bookingId: 'booking-1',
          checkedInByEmail: 'ada@example.com',
        }),
        event('room-released', {
          bookingId: 'booking-1',
          releasedByEmail: 'ada@example.com',
        }),
        event('approval-notification-recorded', {
          bookingId: 'booking-1',
          message: "Ada's booking for Planning was approved.",
        }),
        event('room-retired', { roomId: 'room-1' }),
      ],
      when: {},
      expect: [
        {
          id: 10,
          bookingId: null,
          roomId: 'room-1',
          kind: 'roomRetired',
          message: 'Room room-1 was retired.',
        },
        {
          id: 9,
          bookingId: 'booking-1',
          roomId: null,
          kind: 'approvalNotificationRecorded',
          message: "Ada's booking for Planning was approved.",
        },
        {
          id: 8,
          bookingId: 'booking-1',
          roomId: null,
          kind: 'roomReleased',
          message: 'ada@example.com released the room early.',
        },
        {
          id: 7,
          bookingId: 'booking-1',
          roomId: null,
          kind: 'bookingCheckedIn',
          message: 'ada@example.com checked in.',
        },
        {
          id: 6,
          bookingId: 'booking-1',
          roomId: null,
          kind: 'bookingCanceled',
          message: 'Booking booking-1 was canceled: Changed plans.',
        },
        {
          id: 5,
          bookingId: 'booking-1',
          roomId: 'room-1',
          kind: 'bookingRescheduled',
          message: 'Booking booking-1 moved to 2026-06-01T10:00:00.000Z.',
        },
        {
          id: 4,
          bookingId: 'booking-1',
          roomId: null,
          kind: 'bookingRejected',
          message: 'Lin rejected booking booking-1: No.',
        },
        {
          id: 3,
          bookingId: 'booking-1',
          roomId: null,
          kind: 'bookingApproved',
          message: 'Lin approved booking booking-1.',
        },
        {
          id: 2,
          bookingId: 'booking-1',
          roomId: 'room-1',
          kind: 'bookingRequested',
          message: 'Ada requested Planning.',
        },
        {
          id: 1,
          bookingId: null,
          roomId: 'room-1',
          kind: 'roomCreated',
          message: 'Room Library opened on Floor 1.',
        },
      ],
    },
  )
