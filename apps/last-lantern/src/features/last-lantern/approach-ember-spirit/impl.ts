import { z } from 'zod'
import {
  emberSpiritApproachedEvent,
  lanternHeroNamedEvent,
  lanternRollRequestedEvent,
  lanternTestStartedEvent,
} from '../events'
import { createLastLanternMemoryStore } from '../memory-store'
import { approachEmberSpiritSpec } from './spec'

const store = createLastLanternMemoryStore(() => ({
  started: false,
  named: false,
  approached: false,
}))

export const approachEmberSpirit = approachEmberSpiritSpec
  .inputSchema(
    z
      .object({
        approach: z.enum(['gentle', 'bold', 'cunning']),
        rollId: z.string().min(1),
        chosenAt: z.string().datetime({ offset: true }),
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
  .apply(emberSpiritApproachedEvent, async (_event, state) => {
    state.approached = true
  })
  .handle(async (command, state) => {
    if (!state.started || !state.named) throw new Error('Name the hero first')
    if (state.approached)
      throw new Error('The ember spirit has already been approached')
    return [
      emberSpiritApproachedEvent.create({
        approach: command.approach,
        chosenAt: command.chosenAt,
      }),
      lanternRollRequestedEvent.create({
        rollId: command.rollId,
        challenge: 'read-runes',
        sides: 20,
        count: 1,
        target: 10,
        requestedAt: command.chosenAt,
      }),
    ]
  })
