import { createFileRoute } from '@tanstack/solid-router'
import { createSignal } from 'solid-js'

import { TodoCheersView } from '../features/todos/slices/todo-cheers/TodoCheersView'
import { TodosView } from '../features/todos/slices/todos-view/TodosView'
import { parseTodosViewSearch } from '../features/todos/slices/todos-view/slice'

export const Route = createFileRoute('/')({
  validateSearch: parseTodosViewSearch,
  component: TodosIndexRoute,
})

function TodosIndexRoute() {
  const [cheerRefreshKey, setCheerRefreshKey] = createSignal(0)

  return (
    <TodosView
      onTodosChanged={() => setCheerRefreshKey((key) => key + 1)}
      todoCheer={<TodoCheersView refreshKey={cheerRefreshKey()} />}
    />
  )
}
