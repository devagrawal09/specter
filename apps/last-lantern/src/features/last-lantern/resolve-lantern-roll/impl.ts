import { z } from 'zod'
import {
  emberCaughtEvent,
  emberEscapedEvent,
  lanternRollRequestedEvent,
  physicalRollConfirmedEvent,
  runeTrialFailedEvent,
  runeTrialSucceededEvent,
} from '../events'
import { createLastLanternMemoryStore } from '../memory-store'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'

type Pending = {
  challenge: 'read-runes' | 'catch-ember'
  sides: 6 | 20
  target: number
}
export const {
  store: resolveLanternRollStore,
  layer: resolveLanternRollStoreLayer,
} = createLastLanternMemoryStore('resolveLanternRoll', () => ({
  pending: new Map<string, Pending>(),
  resolved: new Set<string>(),
}))

export const resolveLanternRoll = implementCommand(specification)
  .inputSchema(
    z
      .object({
        rollId: z.string().min(1),
        faces: z.array(z.number().int()).length(1),
        nextRollId: z.string().min(1).nullable(),
        confirmedAt: z.string().datetime({ offset: true }),
      })
      .strict(),
  )
  .store(resolveLanternRollStore)
  .apply(lanternRollRequestedEvent, async (event, state) => {
    state.pending.set(event.payload.rollId, {
      challenge: event.payload.challenge,
      sides: event.payload.sides,
      target: event.payload.target,
    })
  })
  .apply(physicalRollConfirmedEvent, async (event, state) => {
    state.pending.delete(event.payload.rollId)
    state.resolved.add(event.payload.rollId)
  })
  .apply(runeTrialSucceededEvent, async () => undefined)
  .apply(runeTrialFailedEvent, async () => undefined)
  .apply(emberCaughtEvent, async () => undefined)
  .apply(emberEscapedEvent, async () => undefined)
  .handle(async (command, state) => {
    if (state.resolved.has(command.rollId))
      throw new Error('That physical roll has already been resolved')
    const pending = state.pending.get(command.rollId)
    if (!pending) throw new Error('No matching physical roll is pending')
    const face = command.faces[0]
    if (face < 1 || face > pending.sides)
      throw new Error(`Enter a face from 1 to ${pending.sides}`)

    const confirmed = physicalRollConfirmedEvent.create({
      rollId: command.rollId,
      faces: command.faces,
      confirmedAt: command.confirmedAt,
    })

    if (pending.challenge === 'read-runes') {
      if (!command.nextRollId)
        throw new Error('The ember roll identifier is required')
      return [
        confirmed,
        (face >= pending.target
          ? runeTrialSucceededEvent
          : runeTrialFailedEvent
        ).create({
          rollId: command.rollId,
          total: face,
          resolvedAt: command.confirmedAt,
        }),
        lanternRollRequestedEvent.create({
          rollId: command.nextRollId,
          challenge: 'catch-ember',
          sides: 6,
          count: 1,
          target: 4,
          requestedAt: command.confirmedAt,
        }),
      ]
    }

    if (command.nextRollId)
      throw new Error('The final test roll cannot request another roll')
    return [
      confirmed,
      (face >= pending.target ? emberCaughtEvent : emberEscapedEvent).create({
        rollId: command.rollId,
        total: face,
        resolvedAt: command.confirmedAt,
      }),
    ]
  })
