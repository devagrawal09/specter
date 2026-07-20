import { createQuerySlice, event } from '@specter-ts/core/spec'

const at = '2026-07-20T20:00:00.000Z'

export const lanternTableQuerySpec = createQuerySlice('lanternTableQuery')
  .description('Projects the complete public table state for The Last Lantern.')
  .scenarios({
    description:
      'Shows the completed befriending ending and its diagnostic progress.',
    given: [
      event('lantern-test-started', { startedAt: at }),
      event('lantern-hero-named', { name: 'Aster', namedAt: at }),
      event('ember-spirit-approached', { approach: 'gentle', chosenAt: at }),
      event('lantern-roll-requested', {
        rollId: 'roll-runes',
        challenge: 'read-runes',
        sides: 20,
        count: 1,
        target: 10,
        requestedAt: at,
      }),
      event('physical-roll-confirmed', {
        rollId: 'roll-runes',
        faces: [17],
        confirmedAt: at,
      }),
      event('rune-trial-succeeded', {
        rollId: 'roll-runes',
        total: 17,
        resolvedAt: at,
      }),
      event('rune-trial-failed', {
        rollId: 'alternate-rune',
        total: 2,
        resolvedAt: at,
      }),
      event('lantern-roll-requested', {
        rollId: 'roll-ember',
        challenge: 'catch-ember',
        sides: 6,
        count: 1,
        target: 4,
        requestedAt: at,
      }),
      event('physical-roll-confirmed', {
        rollId: 'roll-ember',
        faces: [5],
        confirmedAt: at,
      }),
      event('ember-caught', { rollId: 'roll-ember', total: 5, resolvedAt: at }),
      event('ember-escaped', {
        rollId: 'alternate-ember',
        total: 1,
        resolvedAt: at,
      }),
      event('lantern-checkpoint-recovered', { recoveredAt: at }),
      event('ember-spirit-fate-chosen', { fate: 'befriend', chosenAt: at }),
      event('lantern-player-spoke', {
        utteranceId: 'u1',
        text: 'Seventeen.',
        spokenAt: at,
      }),
      event('lantern-dungeon-master-spoke', {
        utteranceId: 'u2',
        text: 'The rune wakes.',
        spokenAt: at,
      }),
      event('lantern-test-completed', { ending: 'befriend', completedAt: at }),
    ],
    when: {},
    expect: {
      stage: 'complete',
      heroName: 'Aster',
      approach: 'gentle',
      pendingRoll: null,
      lastOutcome:
        'The ember slipped free, but revealed the lantern’s final choice.',
      ending: 'befriend',
      rollsConfirmed: 2,
      checkpointRecovered: true,
      transcript: [
        { id: 'u1', role: 'player', text: 'Seventeen.' },
        { id: 'u2', role: 'dungeon-master', text: 'The rune wakes.' },
      ],
    },
  })
