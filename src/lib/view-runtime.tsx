import { createEffect, createSignal, type Component } from 'solid-js'
import { createStore } from 'solid-js'

import { api } from '../api-client'
import { searchParams } from '../location'
import type { ViewRegistration } from './registry.builders'

const [refreshVersion, setRefreshVersion] = createSignal(0)

type ProjectionResponse =
  | { ok: true; data: unknown }
  | { ok: false; message: string }

type CommandResponse = { ok: true } | { ok: false; message: string }

export function ViewOutlet<TView extends ViewRegistration>(props: {
  view: TView
}) {
  const queryEntries = Object.entries(props.view.queries)
  const triggerEntries = Object.entries(props.view.triggers)
  const initialState = Object.fromEntries(
    queryEntries.map(([alias, projection]) => [
      alias,
      structuredClone(projection.state),
    ]),
  )
  const [queryStores, setQueryStores] = createStore(initialState)
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
        const result = (await (
          response as Response
        ).json()) as ProjectionResponse

        if (!result.ok) {
          throw new Error(result.message)
        }

        const updateQueryStores = setQueryStores as (
          update: (store: Record<string, unknown>) => void,
        ) => void

        updateQueryStores((store) => {
          store[alias] = result.data
        })
      }),
    )
  }

  const triggers = Object.fromEntries(
    triggerEntries.map(([alias, command]) => [
      alias,
      async (input: unknown) => {
        const response = await api.api.command.$post({
          json: { type: command.type, payload: input },
        })
        const result = (await (response as Response).json()) as CommandResponse

        if (!result.ok) {
          throw new Error(result.message)
        }

        const searchInput = getSearchInput()
        const nextRefreshVersion = refreshVersion() + 1

        handledRefreshVersion = nextRefreshVersion
        lastSearchKey = JSON.stringify(searchInput)
        setRefreshVersion(nextRefreshVersion)
        await refreshQueries(searchInput)
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

  const ViewComponent = props.view.component as Component<
    Record<string, unknown>
  >

  return <ViewComponent {...queryStores} {...triggers} />
}

function getSearchInput() {
  const status = searchParams().get('status')
  return { status: status ?? 'all' }
}
