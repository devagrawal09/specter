import { Effect } from 'effect'
import {
  createContext,
  createEffect,
  createSignal,
  createStore,
  type Element,
  Show,
  useContext,
} from 'solid-js'

import { searchParams } from '../location'
import type { AnySpecterClient } from './client'
import type { ViewComponent } from './slice'

const [refreshVersion, setRefreshVersion] = createSignal(0)

type RuntimeSpecterClient = AnySpecterClient

const SpecterClientContext = createContext<RuntimeSpecterClient>()

type RuntimeViewRegistration = {
  queries: Record<string, { name: string }>
  triggers: Record<string, { name: string }>
  component: ViewComponent<Record<string, unknown>>
}

export function SpecterClientProvider(props: {
  client: RuntimeSpecterClient
  children: Element
}) {
  return (
    <SpecterClientContext value={props.client}>
      {props.children}
    </SpecterClientContext>
  )
}

export function useSpecterClient() {
  const client = useContext(SpecterClientContext)

  if (!client) {
    throw new Error('Missing Specter Client context')
  }

  return client
}

export function createRuntimeView<TView extends RuntimeViewRegistration>(
  view: TView,
): ViewComponent<Record<string, never>> {
  return function RuntimeView() {
    return <RuntimeSpecterView view={view} />
  }
}

function RuntimeSpecterView<TView extends RuntimeViewRegistration>(props: {
  view: TView
}) {
  const client = useSpecterClient()
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
      queryEntries.map(async ([alias, queryRef]) => {
        const result = await Effect.runPromise(
          client.query(queryRef.name, input),
        )

        setQueryStores((store) => ({ ...store, [alias]: result }))
      }),
    )
    setIsReady(true)
  }

  const triggers = Object.fromEntries(
    triggerEntries.map(([alias, command]) => [
      alias,
      (input: unknown) => {
        return Effect.gen(function* () {
          yield* client.dispatch(command.name, input)

          const searchInput = getSearchInput()
          const nextRefreshVersion = refreshVersion() + 1

          handledRefreshVersion = nextRefreshVersion
          lastSearchKey = JSON.stringify(searchInput)
          setRefreshVersion(nextRefreshVersion)
          yield* Effect.promise(() => refreshQueries(searchInput))

          setTimeout(() => setRefreshVersion(refreshVersion() + 1), 100)
          setTimeout(() => setRefreshVersion(refreshVersion() + 1), 500)
        })
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
