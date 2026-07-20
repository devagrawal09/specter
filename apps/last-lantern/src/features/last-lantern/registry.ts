import type { EventLogAdapter } from '@specter-ts/core'
import { immediateReactionScheduler } from '@specter-ts/memory'
import { approachEmberSpirit } from './approach-ember-spirit/impl'
import { beginLanternTest } from './begin-lantern-test/impl'
import { chooseEmberFate } from './choose-ember-fate/impl'
import { lastLanternEventDefinitions } from './events'
import { lanternTableQuery } from './lantern-table-query/impl'
import { nameLanternHero } from './name-lantern-hero/impl'
import { recordLanternSpeech } from './record-lantern-speech/impl'
import { recoverLanternCheckpoint } from './recover-lantern-checkpoint/impl'
import { resolveLanternRoll } from './resolve-lantern-roll/impl'

export const lastLanternRegistrations = [
  beginLanternTest,
  nameLanternHero,
  approachEmberSpirit,
  resolveLanternRoll,
  recoverLanternCheckpoint,
  chooseEmberFate,
  recordLanternSpeech,
  lanternTableQuery,
] as const

export function createLastLanternAppConfig(eventLog: EventLogAdapter) {
  return {
    events: lastLanternEventDefinitions,
    eventLog,
    schedule: immediateReactionScheduler,
    slices: lastLanternRegistrations,
  } as const
}

export type LastLanternAppConfig = ReturnType<typeof createLastLanternAppConfig>
