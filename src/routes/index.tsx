import { createFileRoute } from '@tanstack/solid-router'

import { TodosView } from '../features/todos/slices/todos-view/TodosView'
import { parseTodoStatusFilter } from '../features/todos/shared/todo-types'

export const Route = createFileRoute('/')({
  validateSearch: (search) => ({
    status: parseTodoStatusFilter(search.status),
  }),
  component: TodosView,
})
