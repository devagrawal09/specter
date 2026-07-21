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
    async observations(
      input: Omit<
        RuntimeObservationBatch,
        'protocolVersion' | 'kind' | 'requestId'
      >,
    ) {
      const observations = structuredClone(input.observations)
      const message: RuntimeObservationBatch = {
        protocolVersion: 1,
        kind: 'observations.batch',
        requestId: requestId(),
        observations,
      }
      const acknowledgement = await post<RuntimeObservationAcknowledgement>(
        '/observations',
        message,
        {
          kind: 'observations.ack',
          requestId: message.requestId,
        },
      )
      assertCompleteObservationAcknowledgement(message, acknowledgement)
      return acknowledgement
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
    if (signal?.aborted) return
    let response: Response
    try {
      response = await fetchImplementation(`${base}/subscriptions`, {
        method: 'POST',
        headers: {
          accept: 'text/event-stream',
          'content-type': 'application/json',
        },
        body: JSON.stringify(message),
        signal,
      })
    } catch (cause) {
      if (signal?.aborted) return
      throw cause
    }
    if (!response.ok) {
      let payload: unknown
      try {
        payload = JSON.parse(await response.text())
      } catch (cause) {
        throw invalidSubscriptionResponse(response.status, cause)
      }
      let parsed: ProtocolMessage
      try {
        parsed = parseProtocolMessage(payload)
      } catch (cause) {
        throw invalidSubscriptionResponse(response.status, cause)
      }
      if (parsed.kind !== 'subscription.error')
        throw responseMismatch('subscription error kind')
      assertResponseCorrelation(parsed, {
        kind: 'subscription.error',
        requestId: message.requestId,
        operationId: message.operationId,
      })
      throw new SpecterProtocolError({
        code: parsed.error.code,
        message: parsed.error.message,
        status: response.status,
        details: parsed.error.details,
      })
    }
    if (!response.body)
      throw new SpecterProtocolError({
        code: protocolErrorCodes.transport,
        message: 'Subscription response has no body.',
        status: response.status,
      })
    let terminal = false
    let lastSequence = message.afterSequence ?? -1
    try {
      for await (const frame of decodeSse(response.body)) {
        const parsed = parseSubscriptionFrame(frame.data)
        if (
          parsed.kind !== 'subscription.value' &&
          parsed.kind !== 'subscription.error' &&
          parsed.kind !== 'subscription.complete'
        )
          throw responseMismatch('subscription message kind')
        if (frame.eventName !== parsed.kind)
          throw responseMismatch('SSE event name')
        assertResponseCorrelation(parsed, {
          kind: parsed.kind,
          requestId: message.requestId,
          operationId: message.operationId,
        })
        if (terminal)
          throw new SpecterProtocolError({
            code: protocolErrorCodes.transport,
            message: 'Subscription stream sent a frame after termination.',
            status: 502,
          })
        if (parsed.kind === 'subscription.value') {
          if (parsed.sequence <= lastSequence)
            throw new SpecterProtocolError({
              code: protocolErrorCodes.transport,
              message: `Subscription sequence ${parsed.sequence} is not greater than ${lastSequence}.`,
              status: 502,
            })
          lastSequence = parsed.sequence
        }
        terminal =
          parsed.kind === 'subscription.error' ||
          parsed.kind === 'subscription.complete'
        yield parsed
      }
    } catch (cause) {
      if (signal?.aborted) return
      throw cause
    }
    if (signal?.aborted) return
    if (!terminal)
      throw new SpecterProtocolError({
        code: protocolErrorCodes.transport,
        message: 'Subscription stream ended without a terminal frame.',
        status: 502,
      })
  }
}

function parseSubscriptionFrame(data: string) {
  try {
    return parseProtocolMessage(JSON.parse(data))
  } catch (cause) {
    if (
      cause instanceof SpecterProtocolError &&
      cause.code === protocolErrorCodes.versionMismatch
    )
      throw cause
    throw invalidSubscriptionResponse(502, cause)
  }
}

function invalidSubscriptionResponse(status: number, cause: unknown) {
  return new SpecterProtocolError({
    code: protocolErrorCodes.transport,
    message: 'Server returned an invalid subscription response.',
    status,
    cause,
  })
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
  let block: string[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })

      while (true) {
        const line = takeSseLine(buffer, done)
        if (!line) break
        buffer = buffer.slice(line.consumed)
        if (line.value !== '') {
          block.push(line.value)
          continue
        }
        const frame = decodeSseBlock(block)
        block = []
        if (frame) yield frame
      }
      if (done) {
        if (buffer !== '') block.push(buffer)
        const frame = decodeSseBlock(block)
        if (frame) yield frame
        return
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function decodeSseBlock(lines: readonly string[]) {
  let eventName: string | undefined
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator < 0 ? line : line.slice(0, separator)
    const rawValue = separator < 0 ? '' : line.slice(separator + 1)
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue
    if (field === 'event') eventName = value
    else if (field === 'data') dataLines.push(value)
  }
  if (dataLines.length === 0) return undefined
  return { eventName, data: dataLines.join('\n') }
}

function takeSseLine(buffer: string, endOfStream: boolean) {
  const carriageReturn = buffer.indexOf('\r')
  const lineFeed = buffer.indexOf('\n')
  let boundary: number
  if (carriageReturn < 0) boundary = lineFeed
  else if (lineFeed < 0) boundary = carriageReturn
  else boundary = Math.min(carriageReturn, lineFeed)
  if (boundary < 0) return undefined

  if (buffer[boundary] === '\r') {
    if (boundary + 1 === buffer.length && !endOfStream) return undefined
    const consumed = buffer[boundary + 1] === '\n' ? boundary + 2 : boundary + 1
    return { value: buffer.slice(0, boundary), consumed }
  }
  return { value: buffer.slice(0, boundary), consumed: boundary + 1 }
}

function assertCompleteObservationAcknowledgement(
  batch: RuntimeObservationBatch,
  acknowledgement: RuntimeObservationAcknowledgement,
) {
  const observationIds = new Set(
    batch.observations.map((observation) => observation.observationId),
  )
  const rejectedIds = acknowledgement.rejectedObservationIds ?? []
  const rejected = new Set(rejectedIds)
  if (
    rejected.size !== rejectedIds.length ||
    rejectedIds.some((observationId) => !observationIds.has(observationId))
  )
    throw invalidObservationAcknowledgement('invalid rejected IDs')
  if (
    acknowledgement.accepted + acknowledgement.duplicates + rejected.size !==
    batch.observations.length
  )
    throw invalidObservationAcknowledgement(
      'counts that do not account for the submitted batch',
    )
}

function invalidObservationAcknowledgement(reason: string) {
  return new SpecterProtocolError({
    code: protocolErrorCodes.transport,
    message: `Server returned an observation acknowledgement with ${reason}.`,
    status: 502,
  })
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
