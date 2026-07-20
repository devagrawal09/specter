import { createCommandSlice, event } from '@specter-ts/core/spec'

const at = '2026-07-20T20:00:00.000Z'

export const recoverLanternCheckpointSpec = createCommandSlice(
  'recoverLanternCheckpoint',
)
  .description(
    'Records that the browser reloaded and reconstructed the shrine from the event log.',
  )
  .scenarios(
    {
      description: 'Recovers after catching the ember.',
      given: [
        event('ember-caught', {
          rollId: 'roll-ember',
          total: 5,
          resolvedAt: at,
        }),
      ],
      when: { recoveredAt: at },
      expect: [event('lantern-checkpoint-recovered', { recoveredAt: at })],
    },
    {
      description: 'Recovers even when the ember escaped.',
      given: [
        event('ember-escaped', {
          rollId: 'roll-ember',
          total: 2,
          resolvedAt: at,
        }),
      ],
      when: { recoveredAt: at },
      expect: [event('lantern-checkpoint-recovered', { recoveredAt: at })],
    },
    {
      description: 'Rejects recovering the same checkpoint twice.',
      given: [
        event('ember-caught', {
          rollId: 'roll-ember',
          total: 5,
          resolvedAt: at,
        }),
        event('lantern-checkpoint-recovered', { recoveredAt: at }),
      ],
      when: { recoveredAt: at },
      expect: [],
      reject: { reason: 'The checkpoint has already been recovered' },
    },
  )
