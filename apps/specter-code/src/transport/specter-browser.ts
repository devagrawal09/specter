import type {
  CommandExecution,
  CommandExecutionOptions,
  SpecterApp,
  SpecterAppConfig,
  SpecterCommandEnvelope,
  SpecterQueryEnvelope,
  SpecterQueryResult,
} from '@specter-ts/core'

import {
  assertJsonCompatible,
  isRecord,
  isWireError,
  type JsonValue,
  type SpecterWireCommandExecution,
} from './specter-protocol'

export type SpecterBrowserTransportOptions = {
  readonly fetch?: typeof globalThis.fetch
  readonly reconnectDelayMs?: number
}

export class SpecterRemoteError extends Error {
  readonly code: string
  readonly status: number
  readonly details?: JsonValue

  constructor(input: {
    code: string
    message: string
    status: number
    details?: JsonValue
  }) {
    super(input.message)
    this.name = 'SpecterRemoteError'
    this.code = input.code
    this.status = input.status
    this.details = input.details
  }
}

export function createSpecterBrowserTransport<TConfig extends SpecterAppConfig>(
  basePath: string,
  options: SpecterBrowserTransportOptions = {},
): SpecterApp<TConfig> {
  const fetchImplementation = options.fetch ?? globalThis.fetch
  const normalizedBasePath = basePath.replace(/\/$/, '')
  const reconnectDelayMs = options.reconnectDelayMs ?? 250

  async function command<TCommand extends SpecterCommandEnvelope<TConfig>>(
    envelope: TCommand,
    commandOptions?: CommandExecutionOptions,
  ): Promise<CommandExecution> {
    assertJsonCompatible(envelope)
    assertJsonCompatible(commandOptions ?? {})

    const wireExecution = await postJson<SpecterWireCommandExecution>(
      `${normalizedBasePath}/command`,
      { envelope, options: commandOptions ?? {} },
    )

    return {
      events: wireExecution.events as CommandExecution['events'],
      version: wireExecution.version,
      duplicate: wireExecution.duplicate,
      reactions: waitForReactions(wireExecution.reactionId),
    }
  }

  async function query<TQuery extends SpecterQueryEnvelope<TConfig>>(
    envelope: TQuery,
  ): Promise<SpecterQueryResult<TConfig, TQuery['type']>> {
    assertJsonCompatible(envelope)
    return postJson(`${normalizedBasePath}/query`, { envelope })
  }

  function subscribe<TQuery extends SpecterQueryEnvelope<TConfig>>(
    envelope: TQuery,
    subscriptionOptions: { readonly signal?: AbortSignal } = {},
  ): AsyncIterable<SpecterQueryResult<TConfig, TQuery['type']>> {
    assertJsonCompatible(envelope)

    return {
      [Symbol.asyncIterator]() {
        const abortController = new AbortController()
        const abort = () =>
          abortController.abort(subscriptionOptions.signal?.reason)
        if (subscriptionOptions.signal?.aborted) abort()
        else
          subscriptionOptions.signal?.addEventListener('abort', abort, {
            once: true,
          })
        const iterator = subscribeWithReconnect(
          envelope,
          abortController.signal,
        )

        const cleanup = () => {
          abortController.abort()
          subscriptionOptions.signal?.removeEventListener('abort', abort)
        }

        return {
          next: () => iterator.next(),
          async return(value?: SpecterQueryResult<TConfig, TQuery['type']>) {
            cleanup()
            return iterator.return(value)
          },
          async throw(cause?: unknown) {
            cleanup()
            return iterator.throw(cause)
          },
        }
      },
    }
  }

  async function postJson<TResult>(path: string, body: unknown) {
    const response = await fetchImplementation(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = await readJson(response)
    if (!response.ok) throw remoteError(response.status, payload)
    assertJsonCompatible(payload)
    return payload as TResult
  }

  async function waitForReactions(reactionId: string) {
    const response = await fetchImplementation(
      `${normalizedBasePath}/reactions/${encodeURIComponent(reactionId)}`,
      { headers: { accept: 'application/json' } },
    )

    if (response.ok) return
    throw remoteError(response.status, await readJson(response))
  }

  async function* subscribeWithReconnect<
    TQuery extends SpecterQueryEnvelope<TConfig>,
  >(
    envelope: TQuery,
    signal?: AbortSignal,
  ): AsyncGenerator<SpecterQueryResult<TConfig, TQuery['type']>> {
    while (!signal?.aborted) {
      let response: Response
      try {
        response = await fetchImplementation(
          `${normalizedBasePath}/subscribe`,
          {
            method: 'POST',
            headers: {
              accept: 'text/event-stream',
              'content-type': 'application/json',
            },
            body: JSON.stringify({ envelope }),
            signal,
          },
        )
      } catch (cause) {
        if (signal?.aborted || isAbortError(cause)) return
        await abortableDelay(reconnectDelayMs, signal)
        continue
      }

      if (!response.ok) {
        throw remoteError(response.status, await readJson(response))
      }
      if (!response.body) {
        throw new SpecterRemoteError({
          code: 'SPECTER_TRANSPORT_FAILURE',
          message: 'Subscription response did not contain a stream.',
          status: response.status,
        })
      }

      try {
        for await (const event of decodeServerSentEvents(response.body)) {
          if (event.event === 'error') {
            const payload = JSON.parse(event.data) as unknown
            throw remoteError(response.status, payload)
          }
          if (event.event !== 'value') continue

          const payload = JSON.parse(event.data) as unknown
          assertJsonCompatible(payload)
          yield payload as SpecterQueryResult<TConfig, TQuery['type']>
        }
      } catch (cause) {
        if (signal?.aborted || isAbortError(cause)) return
        if (cause instanceof SpecterRemoteError) throw cause
      }

      if (!signal?.aborted) {
        await abortableDelay(reconnectDelayMs, signal)
      }
    }
  }

  return Object.freeze({ command, query, subscribe }) as SpecterApp<TConfig>
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    throw new SpecterRemoteError({
      code: 'SPECTER_TRANSPORT_FAILURE',
      message: 'Specter transport returned invalid JSON.',
      status: response.status,
    })
  }
}

function remoteError(status: number, payload: unknown) {
  if (isWireError(payload)) {
    return new SpecterRemoteError({
      code: payload.error.code,
      message: payload.error.message,
      status,
      details: payload.error.details,
    })
  }

  return new SpecterRemoteError({
    code: 'SPECTER_TRANSPORT_FAILURE',
    message:
      isRecord(payload) && typeof payload.error === 'string'
        ? payload.error
        : `Specter transport failed with HTTP ${status}.`,
    status,
  })
}

async function* decodeServerSentEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: string }> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completed = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder
        .decode(value, { stream: !done })
        .replaceAll('\r\n', '\n')

      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const decoded = decodeEventBlock(block)
        if (decoded) yield decoded
        boundary = buffer.indexOf('\n\n')
      }

      if (done) {
        completed = true
        return
      }
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function decodeEventBlock(block: string) {
  let event = 'message'
  const data: string[] = []

  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trimStart()
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }

  if (data.length === 0) return undefined
  return { event, data: data.join('\n') }
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.resolve()

  return new Promise<void>((resolve) => {
    const timeout = setTimeout(done, milliseconds)
    signal?.addEventListener('abort', done, { once: true })

    function done() {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', done)
      resolve()
    }
  })
}

function isAbortError(cause: unknown) {
  return cause instanceof DOMException && cause.name === 'AbortError'
}
