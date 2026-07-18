import { protocolErrorCodes, SpecterProtocolError } from './errors'
import { parseProtocolMessage } from './validation'
import type {
  CapabilitiesResponse,
  CommandRequest,
  CommandResponse,
  ProtocolMessage,
  ProtocolCapability,
  QueryRequest,
  QueryResponse,
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
      const message = {
        protocolVersion: 1,
        kind: 'capabilities.request',
        requestId: requestId(),
        required,
        optional,
      } as const
      return post<CapabilitiesResponse>('/capabilities', message, {
        kind: 'capabilities.response',
        requestId: message.requestId,
      })
    },
    command(
      input: Omit<CommandRequest, 'protocolVersion' | 'kind' | 'requestId'>,
    ) {
      const message: CommandRequest = {
        protocolVersion: 1,
        kind: 'command.request',
        requestId: requestId(),
        ...input,
      }
      return post<CommandResponse>('/commands', message, {
        kind: 'command.response',
        requestId: message.requestId,
        operationId: message.operationId,
      })
    },
    query(input: Omit<QueryRequest, 'protocolVersion' | 'kind' | 'requestId'>) {
      const message: QueryRequest = {
        protocolVersion: 1,
        kind: 'query.request',
        requestId: requestId(),
        ...input,
      }
      return post<QueryResponse>('/queries', message, {
        kind: 'query.response',
        requestId: message.requestId,
        operationId: message.operationId,
      })
    },
    reactionTicket(reactionTicketId: string) {
      const ticketRequestId = requestId()
      return get<ReactionTicketResponse>(
        `/reaction-tickets/${encodeURIComponent(reactionTicketId)}?requestId=${encodeURIComponent(ticketRequestId)}`,
        {
          kind: 'reaction-ticket.response',
          requestId: ticketRequestId,
          reactionTicketId,
        },
      )
    },
    observations(
      input: Omit<
        RuntimeObservationBatch,
        'protocolVersion' | 'kind' | 'requestId'
      >,
    ) {
      const message: RuntimeObservationBatch = {
        protocolVersion: 1,
        kind: 'observations.batch',
        requestId: requestId(),
        ...input,
      }
      return post<RuntimeObservationAcknowledgement>('/observations', message, {
        kind: 'observations.ack',
        requestId: message.requestId,
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

  async function post<TResult extends ProtocolMessage>(
    path: string,
    body: unknown,
    expected: ResponseExpectation,
  ): Promise<TResult> {
    const response = await fetchImplementation(`${base}${path}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    return decodeJson<TResult>(response, expected)
  }
  async function get<TResult extends ProtocolMessage>(
    path: string,
    expected: ResponseExpectation,
  ): Promise<TResult> {
    return decodeJson<TResult>(
      await fetchImplementation(`${base}${path}`, {
        headers: { accept: 'application/json' },
      }),
      expected,
    )
  }
  async function decodeJson<TResult extends ProtocolMessage>(
    response: Response,
    expected: ResponseExpectation,
  ): Promise<TResult> {
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
    if (isProtocolEnvelope(payload)) {
      const parsed = parseProtocolMessage(payload)
      assertResponseCorrelation(parsed, expected)
      if (!response.ok) throw remoteError(response.status, payload)
      return parsed as TResult
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
        throw responseMismatch('subscription message kind')
      assertResponseCorrelation(parsed, {
        kind: parsed.kind,
        requestId: message.requestId,
        operationId: message.operationId,
      })
      yield parsed
      if (
        parsed.kind === 'subscription.error' ||
        parsed.kind === 'subscription.complete'
      )
        return
    }
  }
}

function isProtocolEnvelope(value: unknown) {
  return (
    typeof value === 'object' &&
    value !== null &&
    'protocolVersion' in value &&
    'kind' in value &&
    'requestId' in value
  )
}

type ResponseExpectation = {
  readonly kind: ProtocolMessage['kind']
  readonly requestId: string
  readonly operationId?: string
  readonly reactionTicketId?: string
}

function assertResponseCorrelation(
  message: ProtocolMessage,
  expected: ResponseExpectation,
) {
  if (message.kind !== expected.kind) throw responseMismatch('message kind')
  if (message.requestId !== expected.requestId)
    throw responseMismatch('request ID')
  if (
    expected.operationId !== undefined &&
    (!('operationId' in message) ||
      message.operationId !== expected.operationId)
  )
    throw responseMismatch('operation ID')
  if (
    expected.reactionTicketId !== undefined &&
    (!('reactionTicketId' in message) ||
      message.reactionTicketId !== expected.reactionTicketId)
  )
    throw responseMismatch('Reaction ticket ID')
}

function responseMismatch(field: string) {
  return new SpecterProtocolError({
    code: protocolErrorCodes.transport,
    message: `Server response has a mismatched ${field}.`,
    status: 502,
  })
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
