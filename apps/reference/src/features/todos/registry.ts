import { addTodo } from './add-todo/impl'
import { changeTodoCompletion } from './change-todo-completion/impl'
import { createTodoCheer } from './create-todo-cheer/impl'
import { removeTodo } from './remove-todo/impl'
import { todoCheers } from './todo-cheers/impl'
import { todoCompletionCheer } from './todo-completion-cheer-reaction/impl'
import { todosQuery } from './todos-query/impl'
import type { CommandRef, QueryRef } from '@specter-ts/core'
import { todoEventDefinitions } from './events'

export const todoRegistrations = {
  addTodo,
  changeTodoCompletion,
  removeTodo,
  createTodoCheer,
  todoCompletionCheer,
  todosQuery,
  todoCheers,
} as const

export const todoSpecterAppConfig = {
  events: todoEventDefinitions,
  slices: todoRegistrations,
} as const

export type TodoSpecterAppConfig = typeof todoSpecterAppConfig

export type TodosQueryRef = QueryRef<typeof todosQuery>
export type TodoCheersRef = QueryRef<typeof todoCheers>
export type AddTodoRef = CommandRef<typeof addTodo>
export type RemoveTodoRef = CommandRef<typeof removeTodo>
export type ChangeTodoCompletionRef = CommandRef<typeof changeTodoCompletion>
