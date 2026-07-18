import { protocolErrorCodes, SpecterProtocolError } from './errors'
import { parseProtocolMessage } from './validation'
import type {
  CapabilitiesResponse,
  CommandRequest,
  CommandResponse,
  ProtocolCapability,
  QueryRequest,
  ReactionTicketResponse,
  RuntimeObservationAcknowledgement,
  RuntimeObservationBatch,
  SubscriptionMessage,
  SubscriptionRequest,
} from './types'

export type SpecterProtocolHttpClientOptions = {
  readonly fetch?: typeof globalThis.fetch
  readonly requestId?: () => string
}

export function createSpecterProtocolHttpClient(
  baseUrl: string,
  options: SpecterProtocolHttpClientOptions = {},
) {
  const fetchImplementation = options.fetch ?? globalThis.fetch
  const requestId = options.requestId ?? (() => crypto.randomUUID())
  const base = baseUrl.replace(/\/$/, '')

  return Object.freeze({
    capabilities(
      required: readonly ProtocolCapability[] = [],
      optional: readonly ProtocolCapability[] = [],
    ) {
      return post<CapabilitiesResponse>('/capabilities', {
        protocolVersion: 1,
        kind: 'capabilities.request',
        requestId: requestId(),
        required,
        optional,
      })
    },
    command(
      input: Omit<CommandRequest, 'protocolVersion' | 'kind' | 'requestId'>,
    ) {
      return post<CommandResponse>('/commands', {
        protocolVersion: 1,
        kind: 'command.request',
        requestId: requestId(),
        ...input,
      })
    },
    query(input: Omit<QueryRequest, 'protocolVersion' | 'kind' | 'requestId'>) {
      return post('/queries', {
        protocolVersion: 1,
        kind: 'query.request',
        requestId: requestId(),
        ...input,
      })
    },
    reactionTicket(reactionTicketId: string) {
      return get<ReactionTicketResponse>(
        `/reaction-tickets/${encodeURIComponent(reactionTicketId)}?requestId=${encodeURIComponent(requestId())}`,
      )
    },
    observations(
      input: Omit<
        RuntimeObservationBatch,
        'protocolVersion' | 'kind' | 'requestId'
      >,
    ) {
      return post<RuntimeObservationAcknowledgement>('/observations', {
        protocolVersion: 1,
        kind: 'observations.batch',
        requestId: requestId(),
        ...input,
      })
    },
    subscribe(
      input: Omit<
        SubscriptionRequest,
        'protocolVersion' | 'kind' | 'requestId'
      >,
      subscriptionOptions: { readonly signal?: AbortSignal } = {},
    ) {
      const message: SubscriptionRequest = {
        protocolVersion: 1,
        kind: 'subscription.request',
        requestId: requestId(),
        ...input,
      }
      return stream(message, subscriptionOptions.signal)
    },
  })

  async function post<TResult>(path: string, body: unknown): Promise<TResult> {
    const response = await fetchImplementation(`${base}${path}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    return decodeJson<TResult>(response)
  }
  async function get<TResult>(path: string): Promise<TResult> {
    return decodeJson<TResult>(
      await fetchImplementation(`${base}${path}`, {
        headers: { accept: 'application/json' },
      }),
    )
  }
  async function decodeJson<TResult>(response: Response): Promise<TResult> {
    let payload: unknown
    try {
      payload = JSON.parse(await response.text())
    } catch (cause) {
      throw new SpecterProtocolError({
        code: protocolErrorCodes.transport,
        message: 'Server returned invalid JSON.',
        status: response.status,
        cause,
      })
    }
    if (!response.ok) throw remoteError(response.status, payload)
    return parseProtocolMessage(payload) as TResult
  }
  async function* stream(
    message: SubscriptionRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<SubscriptionMessage> {
    const response = await fetchImplementation(`${base}/subscriptions`, {
      method: 'POST',
      headers: {
        accept: 'text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify(message),
      signal,
    })
    if (!response.ok) {
      let payload: unknown
      try {
        payload = JSON.parse(await response.text())
      } catch {
        payload = undefined
      }
      throw remoteError(response.status, payload)
    }
    if (!response.body)
      throw new SpecterProtocolError({
        code: protocolErrorCodes.transport,
        message: 'Subscription response has no body.',
        status: response.status,
      })
    for await (const data of decodeSse(response.body)) {
      const parsed = parseProtocolMessage(JSON.parse(data))
      if (
        parsed.kind !== 'subscription.value' &&
        parsed.kind !== 'subscription.error' &&
        parsed.kind !== 'subscription.complete'
      )
        continue
      yield parsed
      if (
        parsed.kind === 'subscription.error' ||
        parsed.kind === 'subscription.complete'
      )
        return
    }
  }
}

async function* decodeSse(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
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
        const data = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (data) yield data
        boundary = buffer.indexOf('\n\n')
      }
      if (done) return
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function remoteError(status: number, payload: unknown) {
  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    const error = (payload as { error?: unknown }).error
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      'message' in error
    ) {
      return new SpecterProtocolError({
        code: String(error.code),
        message: String(error.message),
        status,
      })
    }
  }
  return new SpecterProtocolError({
    code: protocolErrorCodes.transport,
    message: `Specter request failed with HTTP ${status}.`,
    status,
  })
}
