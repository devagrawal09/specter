import addTodoSql from './add-todo/slice'
import changeTodoCompletionSql from './change-todo-completion/slice'
import createTodoCheerSql from './create-todo-cheer/slice'
import removeTodoSql from './remove-todo/slice'
import todoSqlCheers from './todo-cheers/slice'
import todoCompletionCheerSql from './todo-completion-cheer-reaction/slice'
import todosSqlQuery from './todos-query/slice'
import type { CommandRef, QueryRef } from '@specter-ts/core'
import { sqliteEventLog } from '../../specter-sqlite'
import { todoEventDefinitions } from './events'

export const todoSqlRegistrations = [
  addTodoSql,
  changeTodoCompletionSql,
  removeTodoSql,
  createTodoCheerSql,
  todoCompletionCheerSql,
  todosSqlQuery,
  todoSqlCheers,
] as const

export const todoSpecterAppConfig = {
  events: todoEventDefinitions,
  eventLog: sqliteEventLog,
  slices: todoSqlRegistrations,
} as const

export type TodosSqlQueryRef = QueryRef<typeof todosSqlQuery>
export type TodoSqlCheersRef = QueryRef<typeof todoSqlCheers>
export type AddTodoSqlRef = CommandRef<typeof addTodoSql>
export type RemoveTodoSqlRef = CommandRef<typeof removeTodoSql>
export type ChangeTodoCompletionSqlRef = CommandRef<
  typeof changeTodoCompletionSql
>
