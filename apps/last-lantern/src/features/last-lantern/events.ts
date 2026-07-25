import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

const at = z.string().datetime({ offset: true })

export const lanternTestStartedEvent = createEventDefinition(
  'lantern-test-started',
  z.object({ startedAt: at }).strict(),
)
export const lanternHeroNamedEvent = createEventDefinition(
  'lantern-hero-named',
  z.object({ name: z.string().min(1).max(40), namedAt: at }).strict(),
)
export const emberSpiritApproachedEvent = createEventDefinition(
  'ember-spirit-approached',
  z
    .object({ approach: z.enum(['gentle', 'bold', 'cunning']), chosenAt: at })
    .strict(),
)
export const lanternRollRequestedEvent = createEventDefinition(
  'lantern-roll-requested',
  z
    .object({
      rollId: z.string().min(1),
      challenge: z.enum(['read-runes', 'catch-ember']),
      sides: z.union([z.literal(6), z.literal(20)]),
      count: z.literal(1),
      target: z.number().int(),
      requestedAt: at,
    })
    .strict(),
)
export const physicalRollConfirmedEvent = createEventDefinition(
  'physical-roll-confirmed',
  z
    .object({
      rollId: z.string().min(1),
      faces: z.array(z.number().int()).min(1),
      confirmedAt: at,
    })
    .strict(),
)
export const runeTrialSucceededEvent = createEventDefinition(
  'rune-trial-succeeded',
  z
    .object({ rollId: z.string(), total: z.number().int(), resolvedAt: at })
    .strict(),
)
export const runeTrialFailedEvent = createEventDefinition(
  'rune-trial-failed',
  z
    .object({ rollId: z.string(), total: z.number().int(), resolvedAt: at })
    .strict(),
)
export const emberCaughtEvent = createEventDefinition(
  'ember-caught',
  z
    .object({ rollId: z.string(), total: z.number().int(), resolvedAt: at })
    .strict(),
)
export const emberEscapedEvent = createEventDefinition(
  'ember-escaped',
  z
    .object({ rollId: z.string(), total: z.number().int(), resolvedAt: at })
    .strict(),
)
export const lanternCheckpointRecoveredEvent = createEventDefinition(
  'lantern-checkpoint-recovered',
  z.object({ recoveredAt: at }).strict(),
)
export const emberSpiritFateChosenEvent = createEventDefinition(
  'ember-spirit-fate-chosen',
  z
    .object({ fate: z.enum(['free', 'bind', 'befriend']), chosenAt: at })
    .strict(),
)
export const lanternTestCompletedEvent = createEventDefinition(
  'lantern-test-completed',
  z
    .object({ ending: z.enum(['free', 'bind', 'befriend']), completedAt: at })
    .strict(),
)
export const lanternPlayerSpokeEvent = createEventDefinition(
  'lantern-player-spoke',
  z
    .object({ utteranceId: z.string(), text: z.string(), spokenAt: at })
    .strict(),
)
export const lanternDungeonMasterSpokeEvent = createEventDefinition(
  'lantern-dungeon-master-spoke',
  z
    .object({ utteranceId: z.string(), text: z.string(), spokenAt: at })
    .strict(),
)

export const lastLanternEventDefinitions = [
  lanternTestStartedEvent,
  lanternHeroNamedEvent,
  emberSpiritApproachedEvent,
  lanternRollRequestedEvent,
  physicalRollConfirmedEvent,
  runeTrialSucceededEvent,
  runeTrialFailedEvent,
  emberCaughtEvent,
  emberEscapedEvent,
  lanternCheckpointRecoveredEvent,
  emberSpiritFateChosenEvent,
  lanternTestCompletedEvent,
  lanternPlayerSpokeEvent,
  lanternDungeonMasterSpokeEvent,
] as const
