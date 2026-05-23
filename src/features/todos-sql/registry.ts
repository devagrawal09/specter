import { addTodoSql } from './add-todo/slice'
import { changeTodoCompletionSql } from './change-todo-completion/slice'
import { createTodoCheerSql } from './create-todo-cheer/slice'
import { removeTodoSql } from './remove-todo/slice'
import { todoSqlCheers } from './todo-cheers/slice'
import { todoCompletionCheerSql } from './todo-completion-cheer-reaction/slice'
import { todosSqlProjection } from './todos-view/slice'

export const todoSqlRegistrations = [
  addTodoSql,
  changeTodoCompletionSql,
  removeTodoSql,
  createTodoCheerSql,
  todoCompletionCheerSql,
  todosSqlProjection,
  todoSqlCheers,
] as const
