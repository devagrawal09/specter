import {
  createEffect,
  createMemo,
  Loading,
  onCleanup,
  refresh,
  Show,
} from 'solid-js'

import { specterClient } from '../client'
import type { TodoSqlCheersState } from '../features/todos/todo-cheers/slice'

export function TodoCheersView() {
  const cheerState = createMemo(
    () => specterClient.todoCheers({}) as Promise<TodoSqlCheersState>,
  )

  createEffect(() => {
    const intervalId = window.setInterval(() => refresh(cheerState), 10000)

    onCleanup(() => window.clearInterval(intervalId))
  })

  return (
    <Loading fallback={null}>
      <Show when={cheerState().latestCheer}>
        {(cheer) => (
          <p class="m-0 rounded-xl border border-[rgba(47,106,74,0.22)] bg-[rgba(79,184,178,0.16)] px-4 py-3 text-sm font-semibold text-[var(--palm)]">
            {cheer().message}
          </p>
        )}
      </Show>
    </Loading>
  )
}
