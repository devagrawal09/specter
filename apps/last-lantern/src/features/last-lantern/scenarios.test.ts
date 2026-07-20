import { createSpecterApp } from '@specter-ts/core'
import { testSliceImplementations } from '@specter-ts/core/testing'
import { createMemoryEventLog } from '@specter-ts/memory'
import { expect, test } from 'vitest'
import { lastLanternEventDefinitions } from './events'
import { resetLastLanternMemoryStores } from './memory-store'
import {
  createLastLanternAppConfig,
  lastLanternRegistrations,
} from './registry'

testSliceImplementations(lastLanternRegistrations, {
  events: lastLanternEventDefinitions,
  runScenario: async <T>(run: () => Promise<T>) => {
    resetLastLanternMemoryStores()
    return run()
  },
})

test('commits the complete two-roll success path through the real Specter app', async () => {
  resetLastLanternMemoryStores()
  const app = await createSpecterApp(
    createLastLanternAppConfig(createMemoryEventLog()),
  )
  const at = '2026-07-20T20:00:00.000Z'
  const run = async (
    envelope: Parameters<typeof app.command>[0],
    idempotencyKey: string,
  ) => {
    const execution = await app.command(envelope, { idempotencyKey })
    await execution.reactions
  }

  await run({ type: 'beginLanternTest', payload: { startedAt: at } }, 'start')
  await run(
    {
      type: 'nameLanternHero',
      payload: { name: 'Mira', namedAt: at },
    },
    'name',
  )
  await run(
    {
      type: 'approachEmberSpirit',
      payload: {
        approach: 'gentle',
        rollId: 'roll-runes',
        chosenAt: at,
      },
    },
    'approach',
  )
  await run(
    {
      type: 'resolveLanternRoll',
      payload: {
        rollId: 'roll-runes',
        faces: [14],
        nextRollId: 'roll-ember',
        confirmedAt: at,
      },
    },
    'runes',
  )
  await run(
    {
      type: 'resolveLanternRoll',
      payload: {
        rollId: 'roll-ember',
        faces: [5],
        nextRollId: null,
        confirmedAt: at,
      },
    },
    'ember',
  )

  await expect(
    app.query({ type: 'lanternTableQuery', payload: {} }),
  ).resolves.toMatchObject({
    stage: 'reload-checkpoint',
    heroName: 'Mira',
    rollsConfirmed: 2,
    lastOutcome: 'You catch the ember without extinguishing it.',
  })
})
