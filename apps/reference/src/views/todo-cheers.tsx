import { Effect } from 'effect'
import { createEffect, createMemo, Loading, refresh, Show } from 'solid-js'
import { createView } from '@specter-ts/core/view'

import { todoCheers } from 'virtual:specter/refs'

export const TodoCheersView = createView('todo-cheers')
  .queries({ cheer: todoCheers })
  .triggers({})
  .component((props) => {
    const cheerState = createMemo(() => Effect.runPromise(props.cheer({})))

    createEffect(
      () => {},
      () => {
        const intervalId = window.setInterval(() => refresh(cheerState), 10000)

        return () => window.clearInterval(intervalId)
      },
    )

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
  })
