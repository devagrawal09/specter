import { createCommandSlice, event } from '@specter-ts/spec'

export default createCommandSlice('createRoom')
  .description('Creates meeting rooms.')
  .scenarios(
    {
      description: 'Creates a room with a unique name.',
      given: [],
      when: {
        roomId: 'room-1',
        name: 'Boardroom',
        capacity: 10,
        location: 'Floor 2',
      },
      expect: [
        event('room-created', {
          roomId: 'room-1',
          name: 'Boardroom',
          capacity: 10,
          location: 'Floor 2',
        }),
      ],
    },
    {
      description: 'Rejects a room name that is already active.',
      given: [
        event('room-created', {
          roomId: 'room-1',
          name: 'Boardroom',
          capacity: 10,
          location: 'Floor 2',
        }),
      ],
      when: {
        roomId: 'room-2',
        name: 'Boardroom',
        capacity: 8,
        location: 'Floor 3',
      },
      expect: [],
      reject: { reason: 'Room name is already in use' },
    },
    {
      description: 'Reuses a room name after the prior room is retired.',
      given: [
        event('room-created', {
          roomId: 'room-1',
          name: 'Boardroom',
          capacity: 10,
          location: 'Floor 2',
        }),
        event('room-retired', { roomId: 'room-1' }),
      ],
      when: {
        roomId: 'room-2',
        name: 'Boardroom',
        capacity: 8,
        location: 'Floor 3',
      },
      expect: [
        event('room-created', {
          roomId: 'room-2',
          name: 'Boardroom',
          capacity: 8,
          location: 'Floor 3',
        }),
      ],
    },
  )
