import { createCommandSlice, event } from '@specter-ts/core/spec'

const at = '2026-07-20T20:00:00.000Z'

export const approachEmberSpiritSpec = createCommandSlice('approachEmberSpirit')
  .description(
    'Commits the hero to one of three approaches and requests the rune roll.',
  )
  .scenarios(
    {
      description: 'Approaches gently and reveals the rune challenge.',
      given: [
        event('lantern-test-started', { startedAt: at }),
        event('lantern-hero-named', { name: 'Aster', namedAt: at }),
      ],
      when: { approach: 'gentle', rollId: 'roll-runes', chosenAt: at },
      expect: [
        event('ember-spirit-approached', { approach: 'gentle', chosenAt: at }),
        event('lantern-roll-requested', {
          rollId: 'roll-runes',
          challenge: 'read-runes',
          sides: 20,
          count: 1,
          target: 10,
          requestedAt: at,
        }),
      ],
    },
    {
      description: 'Rejects choosing a second approach.',
      given: [
        event('lantern-test-started', { startedAt: at }),
        event('lantern-hero-named', { name: 'Aster', namedAt: at }),
        event('ember-spirit-approached', { approach: 'gentle', chosenAt: at }),
      ],
      when: { approach: 'bold', rollId: 'roll-other', chosenAt: at },
      expect: [],
      reject: { reason: 'The ember spirit has already been approached' },
    },
  )
