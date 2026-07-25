import { Layer } from 'effect'

import {
  approachEmberSpirit,
  approachEmberSpiritStoreLayer,
} from './approach-ember-spirit/impl'
import {
  beginLanternTest,
  beginLanternTestStoreLayer,
} from './begin-lantern-test/impl'
import {
  chooseEmberFate,
  chooseEmberFateStoreLayer,
} from './choose-ember-fate/impl'
import { lastLanternEventDefinitions } from './events'
import {
  lanternTableQuery,
  lanternTableQueryStoreLayer,
} from './lantern-table-query/impl'
import {
  nameLanternHero,
  nameLanternHeroStoreLayer,
} from './name-lantern-hero/impl'
import {
  recordLanternSpeech,
  recordLanternSpeechStoreLayer,
} from './record-lantern-speech/impl'
import {
  recoverLanternCheckpoint,
  recoverLanternCheckpointStoreLayer,
} from './recover-lantern-checkpoint/impl'
import {
  resolveLanternRoll,
  resolveLanternRollStoreLayer,
} from './resolve-lantern-roll/impl'

export const lastLanternRegistrations = {
  beginLanternTest,
  nameLanternHero,
  approachEmberSpirit,
  resolveLanternRoll,
  recoverLanternCheckpoint,
  chooseEmberFate,
  recordLanternSpeech,
  lanternTableQuery,
} as const

export const lastLanternAppConfig = {
  events: lastLanternEventDefinitions,
  slices: lastLanternRegistrations,
} as const

export function createLastLanternStoreLayer() {
  return Layer.mergeAll(
    beginLanternTestStoreLayer,
    nameLanternHeroStoreLayer,
    approachEmberSpiritStoreLayer,
    resolveLanternRollStoreLayer,
    recoverLanternCheckpointStoreLayer,
    chooseEmberFateStoreLayer,
    recordLanternSpeechStoreLayer,
    lanternTableQueryStoreLayer,
  )
}

export type LastLanternAppConfig = typeof lastLanternAppConfig
