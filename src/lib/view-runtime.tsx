import { useSearch } from '@tanstack/solid-router'
import { useServerFn } from '@tanstack/solid-start'
import { createEffect, createSignal, type Component } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'

import { dispatchCommand } from './command'
import { queryProjection } from './projection-query'
import type { Command, ViewRegistration } from './registry'

const [refreshVersion, setRefreshVersion] = createSignal(0)

export function ViewOutlet<TView extends ViewRegistration>(props: {
  view: TView
}) {
  const search = useSearch({ from: '/' })
  const queryProjectionFn = useServerFn(queryProjection)
  const dispatchCommandFn = useServerFn(dispatchCommand)
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

  async function refreshQueries(input = search()) {
    await Promise.all(
      queryEntries.map(async ([alias, projection]) => {
        const result = await queryProjectionFn({
          data: {
            projectionName: projection.name,
            input,
          },
        })

        setQueryStores(alias, reconcile(result))
      }),
    )
  }

  const triggers = Object.fromEntries(
    triggerEntries.map(([alias, command]) => [
      alias,
      async (input: unknown) => {
        await dispatchCommandFn({
          data: { type: command.type, payload: input } as Command,
        })
        const searchInput = search()
        const nextRefreshVersion = refreshVersion() + 1

        handledRefreshVersion = nextRefreshVersion
        lastSearchKey = JSON.stringify(searchInput)
        setRefreshVersion(nextRefreshVersion)
        await refreshQueries(searchInput)
      },
    ]),
  )

  createEffect(() => {
    const input = search()
    const searchKey = JSON.stringify(input)
    const version = refreshVersion()

    if (version === handledRefreshVersion && searchKey === lastSearchKey) {
      return
    }

    handledRefreshVersion = version
    lastSearchKey = searchKey
    void refreshQueries(input)
  })

  const ViewComponent = props.view.component as Component<
    Record<string, unknown>
  >

  return <ViewComponent {...queryStores} {...triggers} />
}
