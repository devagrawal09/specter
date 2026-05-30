import addTodo from './add-todo/slice'
import changeTodoCompletion from './change-todo-completion/slice'
import createTodoCheer from './create-todo-cheer/slice'
import removeTodo from './remove-todo/slice'
import todoCheers from './todo-cheers/slice'
import todoCompletionCheer from './todo-completion-cheer-reaction/slice'
import todosQuery from './todos-query/slice'
import type { CommandRef, QueryRef } from '@specter-ts/core'
import { sqliteEventLog } from '../../db/specter-sqlite'
import { todoEventDefinitions } from './events'

export const todoRegistrations = [
  addTodo,
  changeTodoCompletion,
  removeTodo,
  createTodoCheer,
  todoCompletionCheer,
  todosQuery,
  todoCheers,
] as const

export const todoSpecterAppConfig = {
  events: todoEventDefinitions,
  eventLog: sqliteEventLog,
  slices: todoRegistrations,
} as const

export type TodosQueryRef = QueryRef<typeof todosQuery>
export type TodoCheersRef = QueryRef<typeof todoCheers>
export type AddTodoRef = CommandRef<typeof addTodo>
export type RemoveTodoRef = CommandRef<typeof removeTodo>
export type ChangeTodoCompletionRef = CommandRef<typeof changeTodoCompletion>
