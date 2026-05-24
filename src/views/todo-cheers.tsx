import { Show } from 'solid-js'

import { createViewSpec } from '../lib2/builders'
import { todoCheers } from 'virtual:specter/refs'

export const TodoCheersView = createViewSpec('todo-cheers')
  .queries({ cheer: todoCheers })
  .triggers({})
  .scenarios([])
  .component((props) => (
    <Show when={props.cheer.latestCheer}>
      {(cheer) => (
        <p class="m-0 rounded-xl border border-[rgba(47,106,74,0.22)] bg-[rgba(79,184,178,0.16)] px-4 py-3 text-sm font-semibold text-[var(--palm)]">
          {cheer().message}
        </p>
      )}
    </Show>
  ))
