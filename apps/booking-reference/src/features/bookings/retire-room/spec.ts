import { createCommandSlice, event } from '@specter-ts/spec'
export default createCommandSlice('retireRoom')
  .description('Retires rooms from booking use.')
  .scenarios(
    {
      description: 'Retires an active room with no active bookings.',
      given: [
        event('room-created', {
          roomId: 'room-1',
          name: 'Boardroom',
          capacity: 10,
          location: 'Floor 2',
        }),
      ],
      when: { roomId: 'room-1' },
      expect: [event('room-retired', { roomId: 'room-1' })],
    },
    {
      description: 'Rejects retiring a missing room.',
      given: [],
      when: { roomId: 'missing' },
      expect: [],
      reject: { reason: 'Room not found' },
    },
    {
      description: 'Rejects retiring an already retired room.',
      given: [
        event('room-created', {
          roomId: 'room-1',
          name: 'Boardroom',
          capacity: 10,
          location: 'Floor 2',
        }),
        event('room-retired', { roomId: 'room-1' }),
      ],
      when: { roomId: 'room-1' },
      expect: [],
      reject: { reason: 'Room is already retired' },
    },
    {
      description: 'Rejects retiring a room with an active booking.',
      given: [
        event('room-created', {
          roomId: 'room-1',
          name: 'Boardroom',
          capacity: 10,
          location: 'Floor 2',
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
      when: { roomId: 'room-1' },
      expect: [],
      reject: { reason: 'Room has active bookings' },
    },
  )
