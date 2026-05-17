import { createFileRoute, Link, useRouter } from '@tanstack/solid-router'
import { useServerFn } from '@tanstack/solid-start'
import { createMemo, createSignal, For, Show } from 'solid-js'

import {
  addTodo,
  changeTodoCompletion,
  listTodos,
  removeTodo,
} from '../features/todos/todos.functions'
import {
  parseTodoStatusFilter,
  type TodoStatusFilter,
} from '../features/todos/shared/todo-types'

const filterOptions = [
  { status: 'all', label: 'All' },
  { status: 'active', label: 'Active' },
  { status: 'completed', label: 'Completed' },
] as const

export const Route = createFileRoute('/')({
  validateSearch: (search) => ({
    status: parseTodoStatusFilter(search.status),
  }),
  loaderDeps: ({ search }) => ({ status: search.status }),
  loader: ({ deps }) => listTodos({ data: { status: deps.status } }),
  component: TodoPage,
})

function TodoPage() {
  const router = useRouter()
  const search = Route.useSearch()
  const view = Route.useLoaderData()
  const addTodoFn = useServerFn(addTodo)
  const changeTodoCompletionFn = useServerFn(changeTodoCompletion)
  const removeTodoFn = useServerFn(removeTodo)
  const [title, setTitle] = createSignal('')
  const [isAdding, setIsAdding] = createSignal(false)
  const [pendingToggleId, setPendingToggleId] = createSignal('')
  const [pendingRemoveId, setPendingRemoveId] = createSignal('')
  const [addError, setAddError] = createSignal('')
  const [rowError, setRowError] = createSignal<{
    todoId: string
    message: string
  } | null>(null)
  const normalizedTitle = createMemo(() => title().trim())
  const emptyMessage = createMemo(() => {
    if (search().status === 'active') {
      return 'No active todos.'
    }

    if (search().status === 'completed') {
      return 'No completed todos.'
    }

    return 'No todos yet.'
  })

  async function refreshTodos() {
    await router.invalidate()
  }

  async function submitTodo(event: SubmitEvent) {
    event.preventDefault()
    setAddError('')
    setIsAdding(true)

    try {
      await addTodoFn({ data: { title: title() } })
      setTitle('')
      await refreshTodos()
    } catch (error) {
      setAddError(error instanceof Error ? error.message : 'Unable to add todo')
    } finally {
      setIsAdding(false)
    }
  }

  async function toggleTodo(todoId: string, completed: boolean) {
    setRowError(null)
    setPendingToggleId(todoId)

    try {
      await changeTodoCompletionFn({ data: { todoId, completed } })
      await refreshTodos()
    } catch (error) {
      setRowError({
        todoId,
        message:
          error instanceof Error ? error.message : 'Unable to update todo',
      })
    } finally {
      setPendingToggleId('')
    }
  }

  async function deleteTodo(todoId: string) {
    setRowError(null)
    setPendingRemoveId(todoId)

    try {
      await removeTodoFn({ data: { todoId } })
      await refreshTodos()
    } catch (error) {
      setRowError({
        todoId,
        message:
          error instanceof Error ? error.message : 'Unable to remove todo',
      })
    } finally {
      setPendingRemoveId('')
    }
  }

  return (
    <main class="page-wrap px-4 py-10 sm:py-14">
      <section class="island-shell mx-auto max-w-3xl rounded-2xl p-5 sm:p-6">
        <header class="flex flex-col gap-4 border-b border-[rgba(23,58,64,0.12)] pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 class="m-0 text-2xl font-semibold text-[var(--sea-ink)]">
              Todos
            </h1>
            <p class="mb-0 mt-2 text-sm text-[var(--sea-ink-soft)]">
              {view().totalCount} total · {view().activeCount} active ·{' '}
              {view().completedCount} completed
            </p>
          </div>

          <nav
            aria-label="Todo status"
            class="grid grid-cols-3 rounded-xl border border-[rgba(23,58,64,0.14)] bg-white/55 p-1"
          >
            <For each={filterOptions}>
              {(option) => (
                <FilterLink
                  active={search().status === option.status}
                  label={option.label}
                  status={option.status}
                />
              )}
            </For>
          </nav>
        </header>

        <form
          class="mt-5 grid gap-2 sm:grid-cols-[1fr_auto]"
          onSubmit={submitTodo}
        >
          <label class="sr-only" for="todo-title">
            Todo title
          </label>
          <input
            id="todo-title"
            value={title()}
            onInput={(event) => {
              setTitle(event.currentTarget.value)
              setAddError('')
            }}
            maxlength="120"
            placeholder="Add a todo"
            class="h-11 min-w-0 rounded-xl border border-[rgba(23,58,64,0.16)] bg-white/75 px-3 text-sm text-[var(--sea-ink)] outline-none transition focus:border-[rgba(50,143,151,0.65)]"
          />
          <button
            type="submit"
            disabled={isAdding() || !normalizedTitle()}
            class="h-11 min-w-24 rounded-xl border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.16)] px-5 text-sm font-semibold text-[var(--lagoon-deep)] transition hover:bg-[rgba(79,184,178,0.26)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isAdding() ? 'Adding...' : 'Add'}
          </button>
          <Show when={addError()}>
            <p class="m-0 text-sm font-semibold text-red-700 sm:col-span-2">
              {addError()}
            </p>
          </Show>
        </form>

        <div class="mt-6 grid gap-2">
          <Show
            when={view().todos.length > 0}
            fallback={
              <p class="m-0 rounded-xl border border-dashed border-[rgba(23,58,64,0.18)] px-4 py-6 text-center text-sm text-[var(--sea-ink-soft)]">
                {emptyMessage()}
              </p>
            }
          >
            <For each={view().todos}>
              {(todo) => (
                <article class="grid min-h-14 grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border border-[rgba(23,58,64,0.12)] bg-white/60 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={todo.completed}
                    disabled={pendingToggleId() === todo.id}
                    aria-label={`Mark ${todo.title} ${
                      todo.completed ? 'active' : 'completed'
                    }`}
                    onChange={(event) =>
                      toggleTodo(todo.id, event.currentTarget.checked)
                    }
                    class="h-5 w-5 accent-[var(--lagoon-deep)] disabled:cursor-not-allowed"
                  />
                  <div class="min-w-0">
                    <p
                      class="m-0 break-words text-sm font-medium text-[var(--sea-ink)]"
                      classList={{
                        'text-[var(--sea-ink-soft)] line-through':
                          todo.completed,
                      }}
                    >
                      {todo.title}
                    </p>
                    <Show when={rowError()?.todoId === todo.id}>
                      <p class="mb-0 mt-1 text-xs font-semibold text-red-700">
                        {rowError()?.message}
                      </p>
                    </Show>
                  </div>
                  <button
                    type="button"
                    disabled={pendingRemoveId() === todo.id}
                    onClick={() => deleteTodo(todo.id)}
                    class="h-9 min-w-16 rounded-lg px-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pendingRemoveId() === todo.id ? 'Removing' : 'Remove'}
                  </button>
                </article>
              )}
            </For>
          </Show>
        </div>
      </section>
    </main>
  )
}

function FilterLink(props: {
  active: boolean
  label: string
  status: TodoStatusFilter
}) {
  return (
    <Link
      to="/"
      search={props.status === 'all' ? {} : { status: props.status }}
      class="grid h-9 min-w-20 place-items-center rounded-lg px-3 text-sm font-semibold text-[var(--sea-ink-soft)] no-underline transition hover:text-[var(--sea-ink)]"
      classList={{
        'bg-white text-[var(--sea-ink)] shadow-[0_1px_4px_rgba(23,58,64,0.12)]':
          props.active,
      }}
    >
      {props.label}
    </Link>
  )
}
