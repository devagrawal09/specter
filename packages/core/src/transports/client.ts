import type { StandardSchemaV1 } from '@standard-schema/spec'

import type { SpecterAppConfig } from '../core/registry'
import type { SliceRegistration } from '../core/slice'

const specterClientBrand: unique symbol = Symbol('SpecterClient')
const specterClientBrandValue: true = true

type CommandInput<TSlice> = TSlice extends {
  kind: 'command'
  schema: infer TSchema extends StandardSchemaV1
}
  ? StandardSchemaV1.InferOutput<TSchema>
  : never

type QueryInput<TSlice> = TSlice extends {
  kind: 'query'
  schema: infer TSchema extends StandardSchemaV1
}
  ? StandardSchemaV1.InferOutput<TSchema>
  : never

type QueryOutput<TSlice> = TSlice extends {
  kind: 'query'
  handle: (...args: readonly never[]) => Promise<infer TResult>
}
  ? TResult
  : never

type ClientMethods<TSlices extends readonly SliceRegistration[]> = {
  [TSlice in Extract<TSlices[number], { kind: 'command' }> as TSlice['name']]: (
    input: CommandInput<TSlice>,
  ) => Promise<void>
} & {
  [TSlice in Extract<TSlices[number], { kind: 'query' }> as TSlice['name']]: (
    input: QueryInput<TSlice>,
  ) => Promise<QueryOutput<TSlice>>
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
