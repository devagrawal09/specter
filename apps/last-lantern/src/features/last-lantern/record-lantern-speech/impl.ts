import { z } from 'zod'
import {
  lanternDungeonMasterSpokeEvent,
  lanternPlayerSpokeEvent,
} from '../events'
import { createLastLanternMemoryStore } from '../memory-store'
import { recordLanternSpeechSpec } from './spec'

const store = createLastLanternMemoryStore(() => ({
  utteranceIds: new Set<string>(),
}))

export const recordLanternSpeech = recordLanternSpeechSpec
  .inputSchema(
    z
      .object({
        utteranceId: z.string().min(1),
        role: z.enum(['player', 'dungeon-master']),
        text: z.string().min(1).max(4_000),
        spokenAt: z.string().datetime({ offset: true }),
      })
      .strict(),
  )
  .store(store)
  .apply(lanternPlayerSpokeEvent, async (event, state) => {
    state.utteranceIds.add(event.payload.utteranceId)
  })
  .apply(lanternDungeonMasterSpokeEvent, async (event, state) => {
    state.utteranceIds.add(event.payload.utteranceId)
  })
  .handle(async (command, state) => {
    if (state.utteranceIds.has(command.utteranceId))
      throw new Error('That utterance has already been recorded')
    const text = command.text.trim()
    if (!text) throw new Error('Completed transcript text is required')
    const payload = {
      utteranceId: command.utteranceId,
      text,
      spokenAt: command.spokenAt,
    }
    return [
      command.role === 'player'
        ? lanternPlayerSpokeEvent.create(payload)
        : lanternDungeonMasterSpokeEvent.create(payload),
    ]
  })
