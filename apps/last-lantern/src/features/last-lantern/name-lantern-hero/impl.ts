import { z } from 'zod'
import { lanternHeroNamedEvent, lanternTestStartedEvent } from '../events'
import { createLastLanternMemoryStore } from '../memory-store'
import { nameLanternHeroSpec } from './spec'

const store = createLastLanternMemoryStore(() => ({
  started: false,
  named: false,
}))

export const nameLanternHero = nameLanternHeroSpec
  .inputSchema(
    z
      .object({
        name: z.string().min(1).max(40),
        namedAt: z.string().datetime({ offset: true }),
      })
      .strict(),
  )
  .store(store)
  .apply(lanternTestStartedEvent, async (_event, state) => {
    state.started = true
  })
  .apply(lanternHeroNamedEvent, async (_event, state) => {
    state.named = true
  })
  .handle(async (command, state) => {
    if (!state.started) throw new Error('Begin The Last Lantern first')
    if (state.named) throw new Error('The hero has already been named')
    const name = command.name.trim()
    if (!name) throw new Error('Hero name is required')
    return [lanternHeroNamedEvent.create({ ...command, name })]
  })
