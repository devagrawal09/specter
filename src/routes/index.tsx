import { createFileRoute } from '@tanstack/solid-router'

import { TodosView } from '../features/todos/slices/todos-view/TodosView'
import { parseTodosViewSearch } from '../features/todos/slices/todos-view/slice'

export const Route = createFileRoute('/')({
  validateSearch: parseTodosViewSearch,
  component: TodosView,
})
