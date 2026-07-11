import type {
  CommandInputOf,
  QueryInputOf,
  QueryOutputOf,
  SliceRegistration,
} from '../definition'
import type { SpecterAppConfig } from '../runtime'

const specterClientBrand: unique symbol = Symbol('SpecterClient')
const specterClientBrandValue: true = true

type ClientMethods<TSlices extends readonly SliceRegistration[]> = {
  [TSlice in Extract<TSlices[number], { kind: 'command' }> as TSlice['name']]: (
    input: CommandInputOf<TSlice>,
  ) => Promise<void>
} & {
  [TSlice in Extract<TSlices[number], { kind: 'query' }> as TSlice['name']]: (
    input: QueryInputOf<TSlice>,
  ) => Promise<QueryOutputOf<TSlice>>
}

export type SpecterClient<TConfig extends SpecterAppConfig> = ClientMethods<
  TConfig['slices']
> & {
  readonly config?: TConfig
  readonly [specterClientBrand]: true
}

export type AnySpecterClient = SpecterClient<SpecterAppConfig>

export function defineSpecterClient<const TConfig extends SpecterAppConfig>(
  apiUrl: string,
): SpecterClient<TConfig> {
  const client = new Proxy(
    { [specterClientBrand]: specterClientBrandValue },
    {
      get(target, property, receiver) {
        if (property in target) {
          return Reflect.get(target, property, receiver)
        }

        if (typeof property !== 'string') {
          return undefined
        }

        return (input: unknown) => callSpecter(apiUrl, property, input)
      },
    },
  )

  return client as SpecterClient<TConfig>
}

function callSpecter(apiUrl: string, method: string, input: unknown) {
  return fetch(`${withoutTrailingSlash(apiUrl)}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then(async (response) => {
    const body = (await response.json()) as unknown

    if (!response.ok) {
      const message =
        body && typeof body === 'object' && 'error' in body
          ? String(body.error)
          : response.statusText
      throw new Error(message)
    }

    return body
  })
}

function withoutTrailingSlash(value: string) {
  return value.endsWith('/') ? value.slice(0, -1) : value
}
