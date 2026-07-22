import { createQuerySlice, event } from '@specter-ts/spec'

const at = '2026-07-18T15:00:00.000Z'

export const scoreQuerySpec = createQuerySlice('scoreQuery')
  .description('Returns the lifetime score and its auditable award ledger.')
  .scenarios({
    description: 'Sums permanent point awards in reverse chronological order.',
    given: [
      event('point-awarded', {
        awardKey: 'task:task-1:created',
        reason: 'task-added',
        points: 1,
        subject: { kind: 'task', id: 'task-1' },
        related: [],
        awardedAt: at,
      }),
      event('point-awarded', {
        awardKey: 'task:task-1:first-completion',
        reason: 'task-first-completed',
        points: 1,
        subject: { kind: 'task', id: 'task-1' },
        related: [],
        awardedAt: at,
      }),
    ],
    when: { limit: 50 },
    expect: {
      total: 2,
      awards: [
        {
          awardKey: 'task:task-1:first-completion',
          reason: 'task-first-completed',
          points: 1,
          subject: { kind: 'task', id: 'task-1' },
          related: [],
          awardedAt: at,
        },
        {
          awardKey: 'task:task-1:created',
          reason: 'task-added',
          points: 1,
          subject: { kind: 'task', id: 'task-1' },
          related: [],
          awardedAt: at,
        },
      ],
    },
  })

export default scoreQuerySpec
