import { createServerFn } from '@tanstack/solid-start'
import { z } from 'zod'

import { addTodoInput, handleAddTodo } from './slices/add-todo/add-todo.slice'
import {
  changeTodoCompletionInput,
  handleChangeTodoCompletion,
} from './slices/change-todo-completion/change-todo-completion.slice'
import {
  handleRemoveTodo,
  removeTodoInput,
} from './slices/remove-todo/remove-todo.slice'
import { listTodosInput } from './slices/todos-view/todos-view.slice'
import type { TodoEvent } from './shared/todo-events'
import type { TodoSnapshot } from './shared/todo-types'

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

export function handleTodoCommand(
  state: TodoSnapshot[],
  command: TodoCommand,
): TodoEvent[] {
  if (command.type === 'addTodo') {
    return handleAddTodo(command.payload)
  }

  if (command.type === 'changeTodoCompletion') {
    return handleChangeTodoCompletion(state, command.payload)
  }

  return handleRemoveTodo(state, command.payload)
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
