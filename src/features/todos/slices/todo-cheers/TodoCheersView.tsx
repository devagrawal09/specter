import { createServerFn, useServerFn } from '@tanstack/solid-start'
import { createResource, Show } from 'solid-js'
import { db } from '../../../../db/client.server'
import { latestTodoCheerOrder, todoCheers } from './slice'

type TodoCheersViewProps = {
  refreshKey?: number
}

const getLatestTodoCheer = createServerFn().handler(async () => {
  return db
    .select()
    .from(todoCheers)
    .orderBy(latestTodoCheerOrder)
    .limit(1)
    .get()
})

export function TodoCheersView(props: TodoCheersViewProps) {
  const getLatestTodoCheerFn = useServerFn(getLatestTodoCheer)
  const [latestCheer] = createResource(
    () => props.refreshKey ?? 0,
    () => getLatestTodoCheerFn(),
  )

  return (
    <Show when={latestCheer()}>
      {(cheer) => (
        <p class="m-0 rounded-xl border border-[rgba(47,106,74,0.22)] bg-[rgba(79,184,178,0.16)] px-4 py-3 text-sm font-semibold text-[var(--palm)] sm:col-span-2">
          {cheer().message}
        </p>
      )}
    </Show>
  )
}
