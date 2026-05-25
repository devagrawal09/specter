import { FetchHttpClient } from '@effect/platform'
import { Rpc, RpcClient, RpcGroup, RpcSerialization } from '@effect/rpc'
import { Effect, Layer, Schema } from 'effect'

import type { SpecterAppConfig } from './registry'

const specterClientBrand: unique symbol = Symbol('SpecterClient')
const specterClientBrandValue: true = true

type SpecterClientDefinition = {
  dispatch: (
    commandName: string,
    payload: unknown,
  ) => Effect.Effect<void, unknown>
  query: (queryName: string, input: unknown) => Effect.Effect<unknown, unknown>
}

export type SpecterClient<TConfig extends SpecterAppConfig> = {
  dispatch: (
    commandName: string,
    payload: unknown,
  ) => Effect.Effect<void, unknown>
  query: (queryName: string, input: unknown) => Effect.Effect<unknown, unknown>
  readonly config?: TConfig
  readonly [specterClientBrand]: true
}

export type AnySpecterClient = SpecterClient<SpecterAppConfig>

export function defineSpecterClient<const TConfig extends SpecterAppConfig>(
  client: SpecterClientDefinition,
): SpecterClient<TConfig> {
  return Object.assign(client, {
    [specterClientBrand]: specterClientBrandValue,
  })
}

export const specterRpcGroup = RpcGroup.make(
  Rpc.make('Dispatch', {
    payload: {
      commandName: Schema.String,
      payload: Schema.Unknown,
    },
    error: Schema.String,
  }),
  Rpc.make('Query', {
    payload: {
      queryName: Schema.String,
      input: Schema.Unknown,
    },
    success: Schema.Unknown,
    error: Schema.String,
  }),
)

export function createRpcSpecterClient<const TConfig extends SpecterAppConfig>(
  url = '/rpc',
) {
  const protocolLayer = RpcClient.layerProtocolHttp({ url }).pipe(
    Layer.provide([FetchHttpClient.layer, RpcSerialization.layerNdjson]),
  )

  return defineSpecterClient<TConfig>({
    dispatch: (commandName, payload) =>
      Effect.gen(function* () {
        const client = yield* RpcClient.make(specterRpcGroup)

        yield* client.Dispatch({ commandName, payload }, { discard: true })
      }).pipe(
        Effect.scoped,
        Effect.provide(protocolLayer),
        Effect.mapError(toError),
      ),
    query: (queryName, input) =>
      Effect.gen(function* () {
        const client = yield* RpcClient.make(specterRpcGroup)

        return yield* client.Query({ queryName, input })
      }).pipe(
        Effect.scoped,
        Effect.provide(protocolLayer),
        Effect.mapError(toError),
      ),
  })
}

function toError(cause: unknown) {
  return cause instanceof Error ? cause : new Error(String(cause))
}
