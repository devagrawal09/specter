import { createServerFn } from '@tanstack/solid-start'
import { z } from 'zod'

import { addTodoInput, handleAddTodo } from './slices/add-todo/slice'
import {
  changeTodoCompletionInput,
  decideChangeTodoCompletion,
} from './slices/change-todo-completion/slice'
import { decideRemoveTodo, removeTodoInput } from './slices/remove-todo/slice'
import { listTodosInput } from './slices/todos-view/slice'
import type { TodoEvent } from './shared/todo-events'
import type { TodoStore } from './shared/todo-persistence-types'

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

export const listTodos = createServerFn({ method: 'GET' })
  .inputValidator(listTodosInput)
  .handler(async ({ data }) => {
    const { readVisibleSnapshots } = await import('./todos.persistence.server')

    return readVisibleSnapshots(data.status)
  })

export const dispatchTodoCommand = createServerFn({ method: 'POST' })
  .inputValidator(todoCommandInput)
  .handler(async ({ data }) => {
    const { persistTodoCommand } = await import('./todos.persistence.server')

    return persistTodoCommand(data)
  })
