import { Effect } from 'effect'

import { api } from './api-client'
import type { todoSpecterAppConfig } from './features/todos/registry'
import { defineSpecterClient } from './lib/client'

type TodoSpecterAppConfig = typeof todoSpecterAppConfig

type QueryResponse<T> = { ok: true; data: T } | { ok: false; message: string }

type CommandResponse = { ok: true } | { ok: false; message: string }
type TodoListItem = {
  id: string
  title: string
  completed: boolean
  removed: boolean | null
}
type TodoCheer = {
  milestone: number
  message: string
}
type TodoCheersQueryResult = {
  latestCheer: TodoCheer | null
}

export const todoSpecterClient = defineSpecterClient<TodoSpecterAppConfig>({
  addTodo: (input) => dispatchCommand('addTodo', input),
  changeTodoCompletion: (input) =>
    dispatchCommand('changeTodoCompletion', input),
  removeTodo: (input) => dispatchCommand('removeTodo', input),
  createTodoCheer: (input) => dispatchCommand('createTodoCheer', input),
  todosQuery: (input) => queryApp('todosQuery', input, decodeTodosQuery),
  todoCheers: (input) => queryApp('todoCheers', input, decodeTodoCheers),
})

function dispatchCommand(type: string, payload: unknown) {
  return Effect.tryPromise({
    try: async () => {
      const response = await api.api.command.$post({
        json: { type, payload },
      })
      const result = decodeCommandResponse(await response.json())

      if (!result.ok) {
        throw new Error(result.message)
      }
    },
    catch: (cause) => cause,
  })
}

function queryApp<T>(
  queryName: string,
  input: unknown,
  decodeData: (data: unknown) => T,
) {
  return Effect.tryPromise({
    try: async () => {
      const response = await api.api.query.$get({
        query: {
          queryName,
          input: JSON.stringify(input),
        },
      })
      const result = decodeQueryResponse(await response.json())

      if (!result.ok) {
        throw new Error(result.message)
      }

      return decodeData(result.data)
    },
    catch: (cause) => cause,
  })
}

function decodeTodosQuery(data: unknown): TodoListItem[] {
  if (!Array.isArray(data)) {
    throw new Error('Invalid todosQuery response')
  }

  return data.map((item) => {
    if (!isTodoListItem(item)) {
      throw new Error('Invalid todosQuery response')
    }

    return item
  })
}

function decodeCommandResponse(data: unknown): CommandResponse {
  if (!isObject(data) || !('ok' in data) || typeof data.ok !== 'boolean') {
    throw new Error('Invalid command response')
  }

  if (data.ok) {
    return { ok: true }
  }

  if (!('message' in data) || typeof data.message !== 'string') {
    throw new Error('Invalid command response')
  }

  return { ok: false, message: data.message }
}

function decodeQueryResponse(data: unknown): QueryResponse<unknown> {
  if (!isObject(data) || !('ok' in data) || typeof data.ok !== 'boolean') {
    throw new Error('Invalid query response')
  }

  if (data.ok) {
    if (!('data' in data)) {
      throw new Error('Invalid query response')
    }

    return { ok: true, data: data.data }
  }

  if (!('message' in data) || typeof data.message !== 'string') {
    throw new Error('Invalid query response')
  }

  return { ok: false, message: data.message }
}

function decodeTodoCheers(data: unknown): TodoCheersQueryResult {
  if (!isObject(data) || !('latestCheer' in data)) {
    throw new Error('Invalid todoCheers response')
  }

  const latestCheer = data.latestCheer

  if (latestCheer !== null && !isTodoCheer(latestCheer)) {
    throw new Error('Invalid todoCheers response')
  }

  return { latestCheer }
}

function isTodoListItem(value: unknown): value is TodoListItem {
  return (
    isObject(value) &&
    'id' in value &&
    typeof value.id === 'string' &&
    'title' in value &&
    typeof value.title === 'string' &&
    'completed' in value &&
    typeof value.completed === 'boolean' &&
    'removed' in value &&
    (typeof value.removed === 'boolean' || value.removed === null)
  )
}

function isTodoCheer(value: unknown): value is TodoCheer {
  return (
    isObject(value) &&
    'milestone' in value &&
    typeof value.milestone === 'number' &&
    'message' in value &&
    typeof value.message === 'string'
  )
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}
