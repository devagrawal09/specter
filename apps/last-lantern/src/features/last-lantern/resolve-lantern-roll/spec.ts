import { createCommandSlice, event } from '@specter-ts/core/spec'

const at = '2026-07-20T20:00:00.000Z'

export const resolveLanternRollSpec = createCommandSlice('resolveLanternRoll')
  .description(
    'Confirms a spoken physical die face and applies the exact campaign consequence.',
  )
  .scenarios(
    {
      description: 'Reads the runes and requests the ember-catching roll.',
      given: [
        event('lantern-roll-requested', {
          rollId: 'roll-runes',
          challenge: 'read-runes',
          sides: 20,
          count: 1,
          target: 10,
          requestedAt: at,
        }),
      ],
      when: {
        rollId: 'roll-runes',
        faces: [17],
        nextRollId: 'roll-ember',
        confirmedAt: at,
      },
      expect: [
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
        event('lantern-roll-requested', {
          rollId: 'roll-ember',
          challenge: 'catch-ember',
          sides: 6,
          count: 1,
          target: 4,
          requestedAt: at,
        }),
      ],
    },
    {
      description:
        'A failed rune reading still requests the ember-catching roll.',
      given: [
        event('lantern-roll-requested', {
          rollId: 'roll-runes-low',
          challenge: 'read-runes',
          sides: 20,
          count: 1,
          target: 10,
          requestedAt: at,
        }),
      ],
      when: {
        rollId: 'roll-runes-low',
        faces: [3],
        nextRollId: 'roll-ember-after-low-rune',
        confirmedAt: at,
      },
      expect: [
        event('physical-roll-confirmed', {
          rollId: 'roll-runes-low',
          faces: [3],
          confirmedAt: at,
        }),
        event('rune-trial-failed', {
          rollId: 'roll-runes-low',
          total: 3,
          resolvedAt: at,
        }),
        event('lantern-roll-requested', {
          rollId: 'roll-ember-after-low-rune',
          challenge: 'catch-ember',
          sides: 6,
          count: 1,
          target: 4,
          requestedAt: at,
        }),
      ],
    },
    {
      description: 'The hero catches the ember with a high physical roll.',
      given: [
        event('lantern-roll-requested', {
          rollId: 'roll-ember-caught',
          challenge: 'catch-ember',
          sides: 6,
          count: 1,
          target: 4,
          requestedAt: at,
        }),
      ],
      when: {
        rollId: 'roll-ember-caught',
        faces: [5],
        nextRollId: null,
        confirmedAt: at,
      },
      expect: [
        event('physical-roll-confirmed', {
          rollId: 'roll-ember-caught',
          faces: [5],
          confirmedAt: at,
        }),
        event('ember-caught', {
          rollId: 'roll-ember-caught',
          total: 5,
          resolvedAt: at,
        }),
      ],
    },
    {
      description: 'The ember escapes a low catching roll.',
      given: [
        event('lantern-roll-requested', {
          rollId: 'roll-ember',
          challenge: 'catch-ember',
          sides: 6,
          count: 1,
          target: 4,
          requestedAt: at,
        }),
      ],
      when: {
        rollId: 'roll-ember',
        faces: [2],
        nextRollId: null,
        confirmedAt: at,
      },
      expect: [
        event('physical-roll-confirmed', {
          rollId: 'roll-ember',
          faces: [2],
          confirmedAt: at,
        }),
        event('ember-escaped', {
          rollId: 'roll-ember',
          total: 2,
          resolvedAt: at,
        }),
      ],
    },
    {
      description: 'Rejects resolving an already confirmed roll.',
      given: [
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
          faces: [6],
          confirmedAt: at,
        }),
        event('ember-caught', {
          rollId: 'roll-ember',
          total: 6,
          resolvedAt: at,
        }),
      ],
      when: {
        rollId: 'roll-ember',
        faces: [6],
        nextRollId: null,
        confirmedAt: at,
      },
      expect: [],
      reject: { reason: 'That physical roll has already been resolved' },
    },
    {
      description: 'Covers the failed rune consequence.',
      given: [
        event('rune-trial-failed', {
          rollId: 'old-rune',
          total: 3,
          resolvedAt: at,
        }),
        event('rune-trial-succeeded', {
          rollId: 'other-rune',
          total: 18,
          resolvedAt: at,
        }),
        event('ember-escaped', {
          rollId: 'old-ember',
          total: 1,
          resolvedAt: at,
        }),
      ],
      when: {
        rollId: 'missing',
        faces: [3],
        nextRollId: null,
        confirmedAt: at,
      },
      expect: [],
      reject: { reason: 'No matching physical roll is pending' },
    },
  )
