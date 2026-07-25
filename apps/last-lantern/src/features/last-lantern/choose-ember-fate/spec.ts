import { createCommandSlice, event } from '@specter-ts/spec'

const at = '2026-07-20T20:00:00.000Z'

export const chooseEmberFateSpec = createCommandSlice('chooseEmberFate')
  .description(
    'Makes the final irreversible choice and completes the solo test campaign.',
  )
  .scenarios(
    {
      description: 'Befriends the ember spirit after checkpoint recovery.',
      given: [event('lantern-checkpoint-recovered', { recoveredAt: at })],
      when: { fate: 'befriend', chosenAt: at },
      expect: [
        event('ember-spirit-fate-chosen', { fate: 'befriend', chosenAt: at }),
        event('lantern-test-completed', {
          ending: 'befriend',
          completedAt: at,
        }),
      ],
    },
    {
      description: 'Rejects a second ending.',
      given: [
        event('lantern-checkpoint-recovered', { recoveredAt: at }),
        event('lantern-test-completed', { ending: 'free', completedAt: at }),
      ],
      when: { fate: 'bind', chosenAt: at },
      expect: [],
      reject: { reason: 'The Last Lantern is already complete' },
    },
  )

export default chooseEmberFateSpec
