import { ViewOutlet } from './lib_legacy/view-runtime'
import { TodoCheersView } from './views/todo-cheers'
import { TodosView } from './views/todos'

export function TodoApp() {
  return (
    <main class="page-wrap px-4 py-10 sm:py-14">
      <section class="island-shell mx-auto grid max-w-3xl gap-5 rounded-2xl p-5 sm:p-6">
        <ViewOutlet view={TodoCheersView} />
        <ViewOutlet view={TodosView} />
      </section>
    </main>
  )
}
