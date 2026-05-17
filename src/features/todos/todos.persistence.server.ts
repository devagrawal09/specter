import { createServerFn } from '@tanstack/start-client-core'
import { db } from '../../db/client.server'
import { todoEvents } from '../../db/schema'
import type { StoredTodoEvent, TodoStore, TodoEvent } from './shared'
import {
  applyChangeTodoCompletionEvents,
  changeTodoCompletionInput,
  decideChangeTodoCompletion,
} from './slices/change-todo-completion/slice'
import {
  applyRemoveTodoEvents,
  decideRemoveTodo,
  removeTodoInput,
} from './slices/remove-todo/slice'
import { mutateTodoListItemsFromEvents } from './slices/todos-view/slice'
import z from 'zod'
import { addTodoInput, handleAddTodo } from './slices/add-todo/slice'

export const todoCommandInput = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('addTodo'),
    payload: addTodoInput,
  }),
  z.object({
    type: z.literal('changeTodoCompletion'),
    payload: changeTodoCompletionInput,
  }),
  z.object({
    type: z.literal('removeTodo'),
    payload: removeTodoInput,
  }),
])

export type TodoCommand = z.infer<typeof todoCommandInput>

export function decideTodoCommand(
  tx: TodoStore,
  command: TodoCommand,
): TodoEvent[] {
  if (command.type === 'addTodo') {
    return handleAddTodo(command.payload)
  }

  if (command.type === 'changeTodoCompletion') {
    return decideChangeTodoCompletion(tx, command.payload)
  }

  return decideRemoveTodo(tx, command.payload)
}

export const dispatchTodoCommand = createServerFn({ method: 'POST' })
  .inputValidator(
    z.discriminatedUnion('type', [
      z.object({
        type: z.literal('addTodo'),
        payload: addTodoInput,
      }),
      z.object({
        type: z.literal('changeTodoCompletion'),
        payload: changeTodoCompletionInput,
      }),
      z.object({
        type: z.literal('removeTodo'),
        payload: removeTodoInput,
      }),
    ]),
  )
  .handler(async ({ data: command }) => {
    return db.transaction((tx) => {
      const events = decideTodoCommand(tx, command)
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

      applyChangeTodoCompletionEvents(tx, storedEvents)
      applyRemoveTodoEvents(tx, storedEvents)
      mutateTodoListItemsFromEvents(tx, storedEvents)

      return events
    })
  })
