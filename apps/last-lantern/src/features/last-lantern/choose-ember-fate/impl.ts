import { z } from 'zod'
import {
  emberSpiritFateChosenEvent,
  lanternCheckpointRecoveredEvent,
  lanternTestCompletedEvent,
} from '../events'
import { createLastLanternMemoryStore } from '../memory-store'
import { chooseEmberFateSpec } from './spec'

const store = createLastLanternMemoryStore(() => ({
  recovered: false,
  completed: false,
}))

export const chooseEmberFate = chooseEmberFateSpec
  .inputSchema(
    z
      .object({
        fate: z.enum(['free', 'bind', 'befriend']),
        chosenAt: z.string().datetime({ offset: true }),
      })
      .strict(),
  )
  .store(store)
  .apply(lanternCheckpointRecoveredEvent, async (_event, state) => {
    state.recovered = true
  })
  .apply(lanternTestCompletedEvent, async (_event, state) => {
    state.completed = true
  })
  .handle(async (command, state) => {
    if (!state.recovered)
      throw new Error(
        'Recover the checkpoint before choosing the ember spirit’s fate',
      )
    if (state.completed) throw new Error('The Last Lantern is already complete')
    return [
      emberSpiritFateChosenEvent.create(command),
      lanternTestCompletedEvent.create({
        ending: command.fate,
        completedAt: command.chosenAt,
      }),
    ]
  })
