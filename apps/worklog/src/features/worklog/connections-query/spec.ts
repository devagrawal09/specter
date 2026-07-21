import { createQuerySlice, event } from '@specter-ts/core/spec'

const at = '2026-07-18T15:00:00.000Z'

export const connectionsQuerySpec = createQuerySlice('connectionsQuery')
  .description('Lists current symmetric record connections.')
  .scenarios({
    description: 'Returns connections with their current archival state.',
    given: [
      event('records-connected', {
        connectionId: 'connection-1',
        left: { kind: 'journal', id: 'journal-1' },
        right: { kind: 'topic', id: 'topic-1' },
        connectedAt: at,
      }),
      event('connection-archive-changed', {
        connectionId: 'connection-1',
        archived: true,
        changedAt: at,
      }),
    ],
    when: { includeArchived: true },
    expect: [
      {
        id: 'connection-1',
        left: { kind: 'journal', id: 'journal-1' },
        right: { kind: 'topic', id: 'topic-1' },
        connectedAt: at,
        archived: true,
      },
    ],
  })
