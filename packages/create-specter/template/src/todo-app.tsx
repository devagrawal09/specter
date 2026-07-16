import {
  action,
  createEffect,
  createMemo,
  createOptimistic,
  createSignal,
  Errored,
  For,
  Loading,
  refresh,
  Show,
} from 'solid-js'

import { searchParams, setSearch } from './location'
import { runSpecterCommand, specterTransport } from './specter-transport'

const filterOptions = [
  { status: 'all', label: 'All' },
  { status: 'active', label: 'Active' },
  { status: 'completed', label: 'Completed' },
] as const

type Todo = {
  id: string
  title: string
  completed: boolean
  removed: boolean | null
}

export function TodoApp() {
  const cheerState = createMemo(() =>
    specterTransport.query({ type: 'todoCheers', payload: {} }),
  )
  const status = () => {
    const value = searchParams().get('status')
    return value === 'active' || value === 'completed' ? value : 'all'
  }
  const todos = createMemo<Todo[]>(() =>
    specterTransport.query({
      type: 'todosQuery',
      payload: { status: status() },
    }),
  )
  const [title, setTitle] = createSignal('')
  const [isAdding, setIsAdding] = createOptimistic(false)
  const [pendingToggleId, setPendingToggleId] = createOptimistic('')
  const [pendingRemoveId, setPendingRemoveId] = createOptimistic('')
  const add = action(function* (nextTitle: string) {
    setIsAdding(true)
    yield runSpecterCommand({
      type: 'addTodo',
      payload: {
        todoId: crypto.randomUUID(),
        title: nextTitle,
      },
    })
    refresh(todos)
  })
  const change = action(function* (todoId: string, completed: boolean) {
    setPendingToggleId(todoId)
    yield runSpecterCommand({
      type: 'changeTodoCompletion',
      payload: { todoId, completed },
    })
    refresh(todos)
  })
  const remove = action(function* (todoId: string) {
    setPendingRemoveId(todoId)
    yield runSpecterCommand({ type: 'removeTodo', payload: { todoId } })
    refresh(todos)
  })

  createEffect(
    () => {},
    () => {
      const intervalId = window.setInterval(() => refresh(cheerState), 10000)
      return () => window.clearInterval(intervalId)
    },
  )

  return (
    <main class="page-wrap px-4 py-10 sm:py-14">
      <section class="island-shell mx-auto grid max-w-3xl gap-5 rounded-2xl p-5 sm:p-6">
        <Loading fallback={null}>
          <Show when={cheerState().latestCheer}>
            {(cheer) => (
              <p class="m-0 rounded-xl border border-[rgba(47,106,74,0.22)] bg-[rgba(79,184,178,0.16)] px-4 py-3 text-sm font-semibold text-[var(--palm)]">
                {cheer().message}
              </p>
            )}
          </Show>
        </Loading>

        <Errored
          fallback={(error, retry) => (
            <>
              <p class="text-red-600">Error: {(error() as Error).message}</p>
              <button
                type="button"
                onClick={retry}
                class="mt-2 inline-block rounded-lg border border-[rgba(23,58,64,0.16)] bg-white/75 px-3 py-1 text-sm text-[var(--sea-ink)] transition hover:bg-[rgba(23,58,64,0.08)]"
              >
                Retry
              </button>
            </>
          )}
        >
          <Loading fallback={<p>Loading todos...</p>}>
            <header class="flex flex-col gap-4 border-b border-[rgba(23,58,64,0.12)] pb-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1 class="m-0 text-2xl font-semibold text-[var(--sea-ink)]">
                  Todos
                </h1>
                <p class="mb-0 mt-2 text-sm text-[var(--sea-ink-soft)]">
                  {todos().length} total ·{' '}
                  {todos().filter((todo) => !todo.completed).length} active ·{' '}
                  {todos().filter((todo) => todo.completed).length} completed
                </p>
              </div>

              <nav
                aria-label="Todo status"
                class="grid grid-cols-3 rounded-xl border border-[rgba(23,58,64,0.14)] bg-white/55 p-1"
              >
                <For each={filterOptions}>
                  {(option) => (
                    <button
                      type="button"
                      onClick={() => setSearch({ status: option.status })}
                      class={[
                        'grid h-9 min-w-20 place-items-center rounded-lg px-3 text-sm font-semibold text-[var(--sea-ink-soft)] no-underline transition hover:text-[var(--sea-ink)]',
                        {
                          'bg-white text-[var(--sea-ink)] shadow-[0_1px_4px_rgba(23,58,64,0.12)]':
                            status() === option.status,
                        },
                      ]}
                    >
                      {option.label}
                    </button>
                  )}
                </For>
              </nav>
            </header>

            <form
              class="mt-5 grid gap-2 sm:grid-cols-[1fr_auto]"
              onSubmit={async (event) => {
                event.preventDefault()
                const nextTitle = title()
                setTitle('')
                await add(nextTitle)
              }}
            >
              <label class="sr-only" for="todo-title">
                Todo title
              </label>
              <input
                id="todo-title"
                value={title()}
                onInput={(event) => setTitle(event.currentTarget.value)}
                maxlength="120"
                placeholder="Add a todo"
                class="h-11 min-w-0 rounded-xl border border-[rgba(23,58,64,0.16)] bg-white/75 px-3 text-sm text-[var(--sea-ink)] outline-none transition focus:border-[rgba(50,143,151,0.65)]"
              />
              <button
                type="submit"
                disabled={isAdding() || !title().trim()}
                class="h-11 min-w-24 rounded-xl border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.16)] px-5 text-sm font-semibold text-[var(--lagoon-deep)] transition hover:bg-[rgba(79,184,178,0.26)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isAdding() ? 'Adding...' : 'Add'}
              </button>
            </form>

            <div class="mt-6 grid gap-2">
              <Show
                when={todos().length > 0}
                fallback={
                  <p class="m-0 rounded-xl border border-dashed border-[rgba(23,58,64,0.18)] px-4 py-6 text-center text-sm text-[var(--sea-ink-soft)]">
                    <Show
                      when={status() === 'active'}
                      fallback={
                        <Show
                          when={status() === 'completed'}
                          fallback={'No todos yet.'}
                        >
                          No completed todos.
                        </Show>
                      }
                    >
                      No active todos.
                    </Show>
                  </p>
                }
              >
                <For each={todos()}>
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
                          change(todo.id, event.currentTarget.checked)
                        }
                        class="h-5 w-5 accent-[var(--lagoon-deep)] disabled:cursor-not-allowed"
                      />
                      <p
                        class={[
                          'm-0 min-w-0 break-words text-sm font-medium text-[var(--sea-ink)]',
                          {
                            'text-[var(--sea-ink-soft)] line-through':
                              todo.completed,
                          },
                        ]}
                      >
                        {todo.title}
                      </p>
                      <button
                        type="button"
                        disabled={pendingRemoveId() === todo.id}
                        onClick={() => remove(todo.id)}
                        class="h-9 min-w-16 rounded-lg px-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {pendingRemoveId() === todo.id ? 'Removing' : 'Remove'}
                      </button>
                    </article>
                  )}
                </For>
              </Show>
            </div>
          </Loading>
        </Errored>
      </section>
    </main>
  )
}
