import { createCommandSlice, event } from '@specter-ts/core/spec'

const at = '2026-07-18T15:00:00.000Z'
const connected = event('records-connected', {
  connectionId: 'connection-1',
  left: { kind: 'task', id: 'task-1' },
  right: { kind: 'topic', id: 'topic-1' },
  connectedAt: at,
})

export const changeConnectionArchivedSpec = createCommandSlice(
  'changeConnectionArchived',
)
  .description('Archives or restores an existing connection.')
  .scenarios(
    {
      description: 'Archives an active connection.',
      given: [connected],
      when: { connectionId: 'connection-1', archived: true, changedAt: at },
      expect: [
        event('connection-archive-changed', {
          connectionId: 'connection-1',
          archived: true,
          changedAt: at,
        }),
      ],
    },
    {
      description:
        'Restores an archived connection without awarding points again.',
      given: [
        connected,
        event('connection-archive-changed', {
          connectionId: 'connection-1',
          archived: true,
          changedAt: at,
        }),
      ],
      when: { connectionId: 'connection-1', archived: false, changedAt: at },
      expect: [
        event('connection-archive-changed', {
          connectionId: 'connection-1',
          archived: false,
          changedAt: at,
        }),
      ],
    },
  )
