import { createCommandSlice, event } from '@specter-ts/core/spec'

const at = '2026-07-20T20:00:00.000Z'

export const beginLanternTestSpec = createCommandSlice('beginLanternTest')
  .description('Begins the one and only Last Lantern adventure.')
  .scenarios(
    {
      description: 'Enters the ruined shrine for the first time.',
      given: [],
      when: { startedAt: at },
      expect: [event('lantern-test-started', { startedAt: at })],
    },
    {
      description: 'Rejects starting the same adventure twice.',
      given: [event('lantern-test-started', { startedAt: at })],
      when: { startedAt: at },
      expect: [],
      reject: { reason: 'The Last Lantern has already begun' },
    },
  )
