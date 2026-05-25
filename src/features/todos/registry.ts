import addTodoSql from './add-todo/slice'
import changeTodoCompletionSql from './change-todo-completion/slice'
import createTodoCheerSql from './create-todo-cheer/slice'
import removeTodoSql from './remove-todo/slice'
import todoSqlCheers from './todo-cheers/slice'
import todoCompletionCheerSql from './todo-completion-cheer-reaction/slice'
import todosSqlProjection from './todos-view/slice'
import type { CommandRef, ProjectionRef } from '../../lib2'
import { todoEventDefinitions } from './events'

export const todoSqlRegistrations = [
  addTodoSql,
  changeTodoCompletionSql,
  removeTodoSql,
  createTodoCheerSql,
  todoCompletionCheerSql,
  todosSqlProjection,
  todoSqlCheers,
] as const

export const todoSpecterAppConfig = {
  events: todoEventDefinitions,
  slices: todoSqlRegistrations,
} as const

export type TodosSqlProjectionRef = ProjectionRef<typeof todosSqlProjection>
export type TodoSqlCheersRef = ProjectionRef<typeof todoSqlCheers>
export type AddTodoSqlRef = CommandRef<typeof addTodoSql>
export type RemoveTodoSqlRef = CommandRef<typeof removeTodoSql>
export type ChangeTodoCompletionSqlRef = CommandRef<
  typeof changeTodoCompletionSql
>
