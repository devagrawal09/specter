import { Effect } from 'effect'

import type { SpecterAppConfig } from './registry'

const specterClientBrand: unique symbol = Symbol('SpecterClient')
const specterClientBrandValue: true = true

type CommandResponse = { ok: true } | { ok: false; message: string }
type QueryResponse =
  | { ok: true; data: unknown }
  | { ok: false; message: string }

type JsonResponse = {
  json: () => Promise<unknown>
}

export type SpecterHttpApi = {
  api: {
    command: {
      $post: (request: {
        json: { type: string; payload: unknown }
      }) => Promise<JsonResponse>
    }
    query: {
      $get: (request: {
        query: { queryName: string; input: string }
      }) => Promise<JsonResponse>
    }
  }
}

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

export function createHttpSpecterClient<const TConfig extends SpecterAppConfig>(
  api: SpecterHttpApi,
) {
  return defineSpecterClient<TConfig>({
    dispatch: (commandName, payload) =>
      Effect.tryPromise({
        try: async () => {
          const response = await api.api.command.$post({
            json: { type: commandName, payload },
          })
          const result = decodeCommandResponse(await response.json())

          if (!result.ok) {
            throw new Error(result.message)
          }
        },
        catch: (cause) => cause,
      }),
    query: (queryName, input) =>
      Effect.tryPromise({
        try: async () => {
          const response = await api.api.query.$get({
            query: {
              queryName,
              input: JSON.stringify(input),
            },
          })
          const result = decodeQueryResponse(await response.json())

          if (!result.ok) {
            throw new Error(result.message)
          }

          return result.data
        },
        catch: (cause) => cause,
      }),
  })
}

function decodeCommandResponse(data: unknown): CommandResponse {
  if (!isObject(data) || !('ok' in data) || typeof data.ok !== 'boolean') {
    throw new Error('Invalid command response')
  }

  if (data.ok) {
    return { ok: true }
  }

  if (!('message' in data) || typeof data.message !== 'string') {
    throw new Error('Invalid command response')
  }

  return { ok: false, message: data.message }
}

function decodeQueryResponse(data: unknown): QueryResponse {
  if (!isObject(data) || !('ok' in data) || typeof data.ok !== 'boolean') {
    throw new Error('Invalid query response')
  }

  if (data.ok) {
    if (!('data' in data)) {
      throw new Error('Invalid query response')
    }

    return { ok: true, data: data.data }
  }

  if (!('message' in data) || typeof data.message !== 'string') {
    throw new Error('Invalid query response')
  }

  return { ok: false, message: data.message }
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}
