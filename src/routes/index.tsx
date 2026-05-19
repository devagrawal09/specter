import { createFileRoute } from '@tanstack/solid-router'

import { todosProjection } from '../features/todos-view/slice'
import { ViewOutlet } from '../lib/view-runtime'
import { TodoCheersView } from '../views/todo-cheers'
import { TodosView } from '../views/todos'

export const Route = createFileRoute('/')({
  validateSearch: (search) => todosProjection.schema.parse(search),
  component: TodosIndexRoute,
})

function TodosIndexRoute() {
  return (
    <main class="page-wrap px-4 py-10 sm:py-14">
      <section class="island-shell mx-auto grid max-w-3xl gap-5 rounded-2xl p-5 sm:p-6">
        <ViewOutlet view={TodoCheersView} />
        <ViewOutlet view={TodosView} />
      </section>
    </main>
  )
}
