import {
  digestSpecification,
  parseSpecification,
  type SliceSpecification,
} from '@specter-ts/spec'

import addTodo from './add-todo/spec.json'
import changeTodoCompletion from './change-todo-completion/spec.json'
import createTodoCheer from './create-todo-cheer/spec.json'
import removeTodo from './remove-todo/spec.json'
import todoCheers from './todo-cheers/spec.json'
import todoCompletionCheer from './todo-completion-cheer-reaction/spec.json'
import todosQuery from './todos-query/spec.json'

export const todoSpecifications: readonly SliceSpecification[] = [
  addTodo,
  changeTodoCompletion,
  createTodoCheer,
  removeTodo,
  todoCheers,
  todoCompletionCheer,
  todosQuery,
].map(parseSpecification)

export const todoSpecificationDigests = Object.fromEntries(
  todoSpecifications.map((specification) => [
    specification.name,
    digestSpecification(specification),
  ]),
) as Readonly<Record<string, `sha256:${string}`>>
