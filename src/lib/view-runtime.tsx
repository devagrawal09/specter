import { createEffect, createSignal, createStore, Show } from 'solid-js'

import { api } from '../api-client'
import { searchParams } from '../location'
import type { ViewComponent } from './slice'

const [refreshVersion, setRefreshVersion] = createSignal(0)

type ProjectionResponse =
  | { ok: true; data: unknown }
  | { ok: false; message: string }

type CommandResponse = { ok: true } | { ok: false; message: string }

type RuntimeViewRegistration = {
  queries: Record<string, { name: string }>
  triggers: Record<string, { name: string }>
  component: ViewComponent<Record<string, unknown>>
}

export function ViewOutlet<TView extends RuntimeViewRegistration>(props: {
  view: TView
}) {
  const queryEntries = Object.entries(props.view.queries)
  const triggerEntries = Object.entries(props.view.triggers)
  const initialState: Record<string, unknown> = Object.fromEntries(
    queryEntries.map(([alias]) => [alias, undefined]),
  )
  const [queryStores, setQueryStores] = createStore(initialState)
  const [isReady, setIsReady] = createSignal(queryEntries.length === 0)
  let handledRefreshVersion = 0
  let lastSearchKey = ''

  async function refreshQueries(input = getSearchInput()) {
    await Promise.all(
      queryEntries.map(async ([alias, projection]) => {
        const response = await api.api.projection.$get({
          query: {
            projectionName: projection.name,
            input: JSON.stringify(input),
          },
        })
        const result: ProjectionResponse = await response.json()

        if (!result.ok) {
          throw new Error(result.message)
        }

        setQueryStores((store) => ({ ...store, [alias]: result.data }))
      }),
    )
    setIsReady(true)
  }

  const triggers = Object.fromEntries(
    triggerEntries.map(([alias, command]) => [
      alias,
      async (input: unknown) => {
        const response = await api.api.command.$post({
          json: { type: command.name, payload: input },
        })
        const result: CommandResponse = await response.json()

        if (!result.ok) {
          throw new Error(result.message)
        }

        const searchInput = getSearchInput()
        const nextRefreshVersion = refreshVersion() + 1

        handledRefreshVersion = nextRefreshVersion
        lastSearchKey = JSON.stringify(searchInput)
        setRefreshVersion(nextRefreshVersion)
        await refreshQueries(searchInput)

        setTimeout(() => setRefreshVersion(refreshVersion() + 1), 100)
        setTimeout(() => setRefreshVersion(refreshVersion() + 1), 500)
      },
    ]),
  )

  createEffect(
    () => ({ input: getSearchInput(), version: refreshVersion() }),
    ({ input, version }) => {
      const searchKey = JSON.stringify(input)

      if (version === handledRefreshVersion && searchKey === lastSearchKey) {
        return
      }

      handledRefreshVersion = version
      lastSearchKey = searchKey
      void refreshQueries(input)
    },
  )

  const ViewComponent = props.view.component

  return (
    <Show when={isReady()}>
      <ViewComponent {...queryStores} {...triggers} />
    </Show>
  )
}

function getSearchInput() {
  const status = searchParams().get('status')
  return { status: status ?? 'all' }
}
