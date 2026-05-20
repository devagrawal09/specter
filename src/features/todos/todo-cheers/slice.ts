import { z } from 'zod'
import { createProjectionSpec } from '../../../lib/registry.builders'
import { todoCheerCreatedEvent } from '../events'

export type TodoCheer = {
  milestone: number
  message: string
}

export type TodoCheersState = {
  latestCheer: TodoCheer | null
}

const latestCheerKey = 'latestCheer'

export const todoCheers = createProjectionSpec('todoCheers', { json: true })
  .schema(z.object({}))
  .apply({
    [todoCheerCreatedEvent.type]: (event, store) => {
      const latestCheer = store.get<TodoCheer>(latestCheerKey)

      if (latestCheer && latestCheer.milestone > event.payload.milestone) {
        return
      }

      store.set(latestCheerKey, {
        milestone: event.payload.milestone,
        message: event.payload.message,
      })
    },
  })
  .state({ latestCheer: null } as TodoCheersState)
  .scenarios(
    {
      given: [],
      when: {},
      expect: { latestCheer: null },
    },
    {
      given: [
        todoCheerCreatedEvent.create({
          milestone: 5,
          message: 'Nice work: 5 todos completed.',
        }),
        todoCheerCreatedEvent.create({
          milestone: 10,
          message: 'Nice work: 10 todos completed.',
        }),
      ],
      when: {},
      expect: {
        latestCheer: {
          milestone: 10,
          message: 'Nice work: 10 todos completed.',
        },
      },
    },
  )
  .query((store) => ({
    latestCheer: store.get<TodoCheer>(latestCheerKey) ?? null,
  }))
