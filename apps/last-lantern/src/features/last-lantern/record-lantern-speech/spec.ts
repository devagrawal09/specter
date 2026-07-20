import { createCommandSlice, event } from '@specter-ts/core/spec'

const at = '2026-07-20T20:00:00.000Z'

export const recordLanternSpeechSpec = createCommandSlice('recordLanternSpeech')
  .description('Persists only completed player and Dungeon Master transcripts.')
  .scenarios(
    {
      description: 'Records a completed player utterance.',
      given: [],
      when: {
        utteranceId: 'u-player',
        role: 'player',
        text: 'I rolled seventeen.',
        spokenAt: at,
      },
      expect: [
        event('lantern-player-spoke', {
          utteranceId: 'u-player',
          text: 'I rolled seventeen.',
          spokenAt: at,
        }),
      ],
    },
    {
      description: 'Records a completed Dungeon Master utterance.',
      given: [
        event('lantern-player-spoke', {
          utteranceId: 'u-player',
          text: 'I rolled seventeen.',
          spokenAt: at,
        }),
      ],
      when: {
        utteranceId: 'u-dm',
        role: 'dungeon-master',
        text: 'The rune wakes.',
        spokenAt: at,
      },
      expect: [
        event('lantern-dungeon-master-spoke', {
          utteranceId: 'u-dm',
          text: 'The rune wakes.',
          spokenAt: at,
        }),
      ],
    },
    {
      description: 'Rejects a repeated completed Dungeon Master utterance.',
      given: [
        event('lantern-dungeon-master-spoke', {
          utteranceId: 'u-dm',
          text: 'The rune wakes.',
          spokenAt: at,
        }),
      ],
      when: {
        utteranceId: 'u-dm',
        role: 'dungeon-master',
        text: 'The rune wakes.',
        spokenAt: at,
      },
      expect: [],
      reject: { reason: 'That utterance has already been recorded' },
    },
  )
