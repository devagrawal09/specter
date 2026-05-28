import { createContext, type Element, useContext } from 'solid-js'

import type { AnySpecterClient } from './client'
import type { ViewComponent } from './slice'

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
  const queries = Object.fromEntries(
    queryEntries.map(([alias, queryRef]) => [
      alias,
      (input: unknown) => client.query(queryRef.name, input),
    ]),
  )

  const triggers = Object.fromEntries(
    triggerEntries.map(([alias, command]) => [
      alias,
      (input: unknown) => client.dispatch(command.name, input),
    ]),
  )

  const ViewComponent = props.view.component

  return <ViewComponent {...queries} {...triggers} />
}
