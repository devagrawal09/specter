import { z } from 'zod'
import {
  emberCaughtEvent,
  emberEscapedEvent,
  emberSpiritApproachedEvent,
  emberSpiritFateChosenEvent,
  lanternCheckpointRecoveredEvent,
  lanternDungeonMasterSpokeEvent,
  lanternHeroNamedEvent,
  lanternPlayerSpokeEvent,
  lanternRollRequestedEvent,
  lanternTestCompletedEvent,
  lanternTestStartedEvent,
  physicalRollConfirmedEvent,
  runeTrialFailedEvent,
  runeTrialSucceededEvent,
} from '../events'
import { createLastLanternMemoryStore } from '../memory-store'
import specification from './spec.json' with { type: 'json' }
import { implementQuery } from '@specter-ts/core'

const stage = z.enum([
  'not-started',
  'name-hero',
  'approach-spirit',
  'roll-runes',
  'roll-ember',
  'reload-checkpoint',
  'choose-fate',
  'complete',
])
const pendingRoll = z
  .object({
    rollId: z.string(),
    challenge: z.enum(['read-runes', 'catch-ember']),
    sides: z.union([z.literal(6), z.literal(20)]),
    count: z.literal(1),
    target: z.number().int(),
  })
  .strict()
  .nullable()
const transcriptItem = z
  .object({
    id: z.string(),
    role: z.enum(['player', 'dungeon-master']),
    text: z.string(),
  })
  .strict()

type TableState = {
  stage: z.infer<typeof stage>
  heroName: string | null
  approach: 'gentle' | 'bold' | 'cunning' | null
  pendingRoll: z.infer<typeof pendingRoll>
  lastOutcome: string | null
  ending: 'free' | 'bind' | 'befriend' | null
  rollsConfirmed: number
  checkpointRecovered: boolean
  transcript: Array<z.infer<typeof transcriptItem>>
}

export const {
  store: lanternTableQueryStore,
  layer: lanternTableQueryStoreLayer,
} = createLastLanternMemoryStore<TableState>('lanternTableQuery', () => ({
  stage: 'not-started',
  heroName: null,
  approach: null,
  pendingRoll: null,
  lastOutcome: null,
  ending: null,
  rollsConfirmed: 0,
  checkpointRecovered: false,
  transcript: [],
}))

export const lanternTableQuery = implementQuery(specification)
  .inputSchema(z.object({}).strict())
  .outputSchema(
    z
      .object({
        stage,
        heroName: z.string().nullable(),
        approach: z.enum(['gentle', 'bold', 'cunning']).nullable(),
        pendingRoll,
        lastOutcome: z.string().nullable(),
        ending: z.enum(['free', 'bind', 'befriend']).nullable(),
        rollsConfirmed: z.number().int(),
        checkpointRecovered: z.boolean(),
        transcript: z.array(transcriptItem),
      })
      .strict(),
  )
  .store(lanternTableQueryStore)
  .apply(lanternTestStartedEvent, async (_event, state) => {
    state.stage = 'name-hero'
  })
  .apply(lanternHeroNamedEvent, async (event, state) => {
    state.heroName = event.payload.name
    state.stage = 'approach-spirit'
  })
  .apply(emberSpiritApproachedEvent, async (event, state) => {
    state.approach = event.payload.approach
  })
  .apply(lanternRollRequestedEvent, async (event, state) => {
    state.pendingRoll = {
      rollId: event.payload.rollId,
      challenge: event.payload.challenge,
      sides: event.payload.sides,
      count: event.payload.count,
      target: event.payload.target,
    }
    state.stage =
      event.payload.challenge === 'read-runes' ? 'roll-runes' : 'roll-ember'
  })
  .apply(physicalRollConfirmedEvent, async (_event, state) => {
    state.pendingRoll = null
    state.rollsConfirmed += 1
  })
  .apply(runeTrialSucceededEvent, async (_event, state) => {
    state.lastOutcome =
      'The celestial rune opens and the ember spirit recognizes you.'
  })
  .apply(runeTrialFailedEvent, async (_event, state) => {
    state.lastOutcome =
      'The rune flares painfully, but its hidden pattern becomes visible.'
  })
  .apply(emberCaughtEvent, async (_event, state) => {
    state.lastOutcome = 'You catch the ember without extinguishing it.'
    state.stage = 'reload-checkpoint'
  })
  .apply(emberEscapedEvent, async (_event, state) => {
    state.lastOutcome =
      'The ember slipped free, but revealed the lantern’s final choice.'
    state.stage = 'reload-checkpoint'
  })
  .apply(lanternCheckpointRecoveredEvent, async (_event, state) => {
    state.checkpointRecovered = true
    state.stage = 'choose-fate'
  })
  .apply(emberSpiritFateChosenEvent, async (event, state) => {
    state.ending = event.payload.fate
  })
  .apply(lanternPlayerSpokeEvent, async (event, state) => {
    state.transcript.push({
      id: event.payload.utteranceId,
      role: 'player',
      text: event.payload.text,
    })
  })
  .apply(lanternDungeonMasterSpokeEvent, async (event, state) => {
    state.transcript.push({
      id: event.payload.utteranceId,
      role: 'dungeon-master',
      text: event.payload.text,
    })
  })
  .apply(lanternTestCompletedEvent, async (event, state) => {
    state.ending = event.payload.ending
    state.stage = 'complete'
  })
  .handle(async (_query, state) => ({
    ...state,
    transcript: state.transcript.slice(-8),
  }))
