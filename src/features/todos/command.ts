import { createServerFn } from '@tanstack/start-client-core'

import { db } from '../../db/client.server'
import { todoEvents } from '../../db/schema'
import type { StoredTodoEvent } from './shared'
import { applyEvents, commandInput, decideCommand } from './registry'

export const dispatchCommand = createServerFn({ method: 'POST' })
  .inputValidator(commandInput)
  .handler(async ({ data: command }) => {
    return db.transaction((tx) => {
      const events = decideCommand(tx, command)
      if (events.length === 0) {
        return []
      }

      const storedEvents = events.map((event) => {
        const row = tx
          .insert(todoEvents)
          .values({
            type: event.type,
            payload: JSON.stringify(event.payload),
            createdAt: new Date(),
          })
          .returning({
            id: todoEvents.id,
            type: todoEvents.type,
            payload: todoEvents.payload,
          })
          .get()

        if (!row) {
          throw new Error('Failed to persist todo event')
        }

        const payload: unknown = JSON.parse(row.payload)

        return {
          id: row.id,
          type: row.type,
          payload: payload,
        } as StoredTodoEvent
      })

      applyEvents(tx, storedEvents)

      return events
    })
  })
