import { createFileRoute } from '@tanstack/solid-router'

import { TodosView } from '../features/todos/slices/todos-view/TodosView'
import { parseTodosViewSearch } from '../features/todos/slices/todos-view/model'

export const Route = createFileRoute('/')({
  validateSearch: parseTodosViewSearch,
  component: TodosView,
})
