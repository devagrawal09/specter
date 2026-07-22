import { createCommandSlice, event } from '@specter-ts/spec'

const at = '2026-07-20T20:00:00.000Z'

export const nameLanternHeroSpec = createCommandSlice('nameLanternHero')
  .description('Names the single hero who enters the ruined shrine.')
  .scenarios(
    {
      description: 'Records the hero name after the adventure begins.',
      given: [event('lantern-test-started', { startedAt: at })],
      when: { name: 'Aster', namedAt: at },
      expect: [event('lantern-hero-named', { name: 'Aster', namedAt: at })],
    },
    {
      description: 'Rejects renaming the hero during the test.',
      given: [
        event('lantern-test-started', { startedAt: at }),
        event('lantern-hero-named', { name: 'Aster', namedAt: at }),
      ],
      when: { name: 'Nova', namedAt: at },
      expect: [],
      reject: { reason: 'The hero has already been named' },
    },
  )

export default nameLanternHeroSpec
