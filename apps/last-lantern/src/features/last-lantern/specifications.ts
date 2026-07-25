import {
  digestSpecification,
  parseSpecification,
  type SliceSpecification,
} from '@specter-ts/spec'

import approachEmberSpirit from './approach-ember-spirit/spec.json'
import beginLanternTest from './begin-lantern-test/spec.json'
import chooseEmberFate from './choose-ember-fate/spec.json'
import lanternTableQuery from './lantern-table-query/spec.json'
import nameLanternHero from './name-lantern-hero/spec.json'
import recordLanternSpeech from './record-lantern-speech/spec.json'
import recoverLanternCheckpoint from './recover-lantern-checkpoint/spec.json'
import resolveLanternRoll from './resolve-lantern-roll/spec.json'

export const lastLanternSpecifications: readonly SliceSpecification[] = [
  approachEmberSpirit,
  beginLanternTest,
  chooseEmberFate,
  lanternTableQuery,
  nameLanternHero,
  recordLanternSpeech,
  recoverLanternCheckpoint,
  resolveLanternRoll,
].map(parseSpecification)

export const lastLanternSpecificationDigests = Object.fromEntries(
  lastLanternSpecifications.map((specification) => [
    specification.name,
    digestSpecification(specification),
  ]),
) as Readonly<Record<string, `sha256:${string}`>>
