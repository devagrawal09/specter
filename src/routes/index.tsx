import { createFileRoute } from '@tanstack/solid-router'
import { createSignal } from 'solid-js'

import { todoCheersSliceRegistration } from '../features/todos/slices/todo-cheers/slice'
import { todosViewSliceRegistration } from '../features/todos/slices/todos-view/slice'

const TodosView = todosViewSliceRegistration.component
const TodoCheersView = todoCheersSliceRegistration.component

export const Route = createFileRoute('/')({
  validateSearch: (search) => todosViewSliceRegistration.schema.parse(search),
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
