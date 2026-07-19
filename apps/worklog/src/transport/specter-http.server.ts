import {
  ReactionRunFailure,
  SpecterError,
  specterErrorCodes,
  type CommandExecutionOptions,
  type SpecterApp,
  type SpecterAppConfig,
  type SpecterCommandEnvelope,
  type SpecterQueryEnvelope,
} from '@specter-ts/core'

import {
  assertJsonCompatible,
  isRecord,
  specterClientHeader,
  specterClientHeaderValue,
  type JsonValue,
  type SpecterWireError,
} from './specter-protocol'

type RunInContext = <T>(operation: () => Promise<T>) => Promise<T>

export type SpecterHttpHandlerOptions<TConfig extends SpecterAppConfig> = {
  readonly app: SpecterApp<TConfig>
  readonly basePath: string
  readonly run?: RunInContext
  readonly reactionRetentionMs?: number
  readonly reactionTickets?: SpecterReactionTicketStore
  readonly allowedOrigins?: readonly string[]
}

export type SpecterHttpHandler = {
  (request: Request): Promise<Response>
  close(reason?: unknown): Promise<void>
  activeSubscriptionCount(): number
}

export type SettledReaction =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: SerializedError }

export type SerializedError = {
  readonly status: number
  readonly body: SpecterWireError
}

export type SpecterReactionRecovery = {
  readonly envelope: unknown
  readonly options: CommandExecutionOptions
}

export type SpecterReactionTicket =
  | {
      readonly status: 'pending'
      readonly recovery: SpecterReactionRecovery
    }
  | {
      readonly status: 'settled'
      readonly result: SettledReaction
    }

export type SpecterReactionTicketStore = {
  create(
    reactionId: string,
    expiresAt: Date,
    recovery: SpecterReactionRecovery,
  ): Promise<void>
  settle(reactionId: string, result: SettledReaction): Promise<void>
  get(reactionId: string): Promise<SpecterReactionTicket | undefined>
}

export function createMemoryReactionTicketStore(): SpecterReactionTicketStore {
  type Ticket = {
    result?: SettledReaction
    expiresAt: number
    recovery: SpecterReactionRecovery
  }
  const tickets = new Map<string, Ticket>()

  const prune = () => {
    const now = Date.now()
    for (const [reactionId, ticket] of tickets) {
      if (ticket.expiresAt <= now) tickets.delete(reactionId)
    }
  }

  return {
    async create(reactionId, expiresAt, recovery) {
      prune()
      tickets.set(reactionId, {
        expiresAt: expiresAt.getTime(),
        recovery,
      })
    },
    async settle(reactionId, result) {
      const ticket = tickets.get(reactionId)
      if (!ticket) return
      ticket.result = result
    },
    async get(reactionId) {
      prune()
      const ticket = tickets.get(reactionId)
      if (!ticket) return undefined
      return ticket.result
        ? { status: 'settled', result: ticket.result }
        : { status: 'pending', recovery: ticket.recovery }
    },
  }
}

export function createSpecterHttpHandler<TConfig extends SpecterAppConfig>(
  options: SpecterHttpHandlerOptions<TConfig>,
): SpecterHttpHandler {
  const basePath = `/${options.basePath.replace(/^\/+|\/+$/g, '')}`
  const run: RunInContext = options.run ?? ((operation) => operation())
  const reactionRetentionMs = options.reactionRetentionMs ?? 5 * 60_000
  const reactionTickets =
    options.reactionTickets ?? createMemoryReactionTicketStore()
  const allowedOrigins = new Set(options.allowedOrigins ?? [])
  const activeSubscriptions = new Set<(reason?: unknown) => Promise<void>>()
  const pendingSubscriptionSetups = new Set<{
    readonly settled: Promise<void>
    abort(reason?: unknown): void
  }>()
  let closing = false
  let closingReason: unknown
  let resolveClosing!: () => void
  const closingStarted = new Promise<void>((resolve) => {
    resolveClosing = resolve
  })
  let closePromise: Promise<void> | undefined

  const handleSpecterHttpRequest = async (request: Request) => {
    const url = new URL(request.url)
    const route = url.pathname.slice(basePath.length) || '/'

    if (!url.pathname.startsWith(`${basePath}/`)) {
      return errorResponse(404, 'SPECTER_ROUTE_NOT_FOUND', 'Route not found.')
    }

    try {
      validateLocalRequest(request, allowedOrigins)

      if (request.method === 'POST' && route === '/command') {
        return await handleCommand(request)
      }
      if (request.method === 'POST' && route === '/query') {
        return await handleQuery(request)
      }
      if (request.method === 'POST' && route === '/subscribe') {
        return await handleSubscription(request)
      }
      if (request.method === 'GET' && route.startsWith('/reactions/')) {
        return await handleReaction(route.slice('/reactions/'.length))
      }

      return errorResponse(404, 'SPECTER_ROUTE_NOT_FOUND', 'Route not found.')
    } catch (cause) {
      return serializedErrorResponse(serializeError(cause))
    }
  }

  handleSpecterHttpRequest.close = (reason?: unknown) => {
    if (closePromise) return closePromise

    closing = true
    closingReason = reason
    resolveClosing()
    closePromise = (async () => {
      while (
        pendingSubscriptionSetups.size > 0 ||
        activeSubscriptions.size > 0
      ) {
        const pendingSetups = [...pendingSubscriptionSetups]
        for (const setup of pendingSetups) setup.abort(reason)
        await Promise.allSettled([
          ...pendingSetups.map(({ settled }) => settled),
          ...[...activeSubscriptions].map((cleanup) => cleanup(reason)),
        ])
      }
    })()
    return closePromise
  }
  handleSpecterHttpRequest.activeSubscriptionCount = () =>
    activeSubscriptions.size

  async function handleCommand(request: Request) {
    const body = await readJsonBody(request)
    const envelope = body.envelope
    const requestedCommandOptions = body.options ?? {}
    assertJsonCompatible(envelope)
    assertJsonCompatible(requestedCommandOptions)

    const reactionId = crypto.randomUUID()
    const commandOptions = {
      ...(requestedCommandOptions as CommandExecutionOptions),
      idempotencyKey:
        (requestedCommandOptions as CommandExecutionOptions).idempotencyKey ??
        reactionId,
    }
    await reactionTickets.create(
      reactionId,
      new Date(Date.now() + reactionRetentionMs),
      { envelope, options: commandOptions },
    )

    const execution = await run(() =>
      options.app.command(
        envelope as SpecterCommandEnvelope<TConfig>,
        commandOptions,
      ),
    )

    trackReactionCompletion(reactionId, execution.reactions)

    const response = {
      events: execution.events,
      version: execution.version,
      duplicate: execution.duplicate,
      reactionId,
    }
    assertJsonCompatible(response)
    return Response.json(response)
  }

  async function handleQuery(request: Request) {
    const body = await readJsonBody(request)
    assertJsonCompatible(body.envelope)
    const result = await run(() =>
      options.app.query(body.envelope as SpecterQueryEnvelope<TConfig>),
    )
    assertJsonCompatible(result)
    return Response.json(result)
  }

  async function handleSubscription(request: Request) {
    const abortController = new AbortController()
    let finishSetup!: () => void
    const setupSettled = new Promise<void>((resolve) => {
      finishSetup = resolve
    })
    const setup = {
      settled: setupSettled,
      abort: (reason?: unknown) => abortController.abort(reason),
    }
    pendingSubscriptionSetups.add(setup)

    let activeCleanup: ((reason?: unknown) => Promise<void>) | undefined
    const abortRequest = () => {
      abortController.abort(request.signal.reason)
      void activeCleanup?.(request.signal.reason)
    }
    if (request.signal.aborted) abortRequest()
    else request.signal.addEventListener('abort', abortRequest, { once: true })

    const finishPendingSetup = () => {
      if (!pendingSubscriptionSetups.delete(setup)) return
      finishSetup()
    }

    let iterator: AsyncIterator<unknown>
    try {
      const body = await readSubscriptionBody(request)
      if (closing) throw new SpecterTransportClosingError()
      assertJsonCompatible(body.envelope)
      if (closing) throw new SpecterTransportClosingError()

      iterator = await run(async () =>
        options.app
          .subscribe(body.envelope as SpecterQueryEnvelope<TConfig>, {
            signal: abortController.signal,
          })
          [Symbol.asyncIterator](),
      )
    } catch (cause) {
      request.signal.removeEventListener('abort', abortRequest)
      finishPendingSetup()
      throw cause
    }
    const encoder = new TextEncoder()
    let cleanupPromise: Promise<void> | undefined
    let streamController:
      | ReadableStreamDefaultController<Uint8Array>
      | undefined
    let streamClosed = false
    let terminal = false

    const closeStream = () => {
      if (!streamController || streamClosed) return
      streamClosed = true
      try {
        streamController.close()
      } catch {
        // Cancellation may close the stream before its source cleanup runs.
      }
    }

    const cleanup = (reason?: unknown) => {
      terminal = true
      closeStream()
      cleanupPromise ??= (async () => {
        abortController.abort(reason)
        request.signal.removeEventListener('abort', abortRequest)
        try {
          await run(async () => {
            await iterator.return?.()
          })
        } catch {
          // Cleanup is best effort, but ownership remains active until it settles.
        } finally {
          activeSubscriptions.delete(cleanup)
        }
      })()
      return cleanupPromise
    }
    activeCleanup = cleanup
    activeSubscriptions.add(cleanup)
    finishPendingSetup()

    if (closing) {
      await cleanup(closingReason)
      throw new SpecterTransportClosingError()
    }

    if (request.signal.aborted) await cleanup(request.signal.reason)

    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller
          if (terminal) closeStream()
        },
        async pull(controller) {
          if (terminal) {
            closeStream()
            return
          }

          try {
            const next = await run(() => iterator.next())
            if (terminal) {
              closeStream()
              return
            }
            if (next.done) {
              await cleanup()
              return
            }
            assertJsonCompatible(next.value)
            if (terminal) {
              closeStream()
              return
            }
            controller.enqueue(
              encoder.encode(
                `event: value\ndata: ${JSON.stringify(next.value)}\n\n`,
              ),
            )
          } catch (cause) {
            if (terminal) {
              await cleanup(cause)
              return
            }
            const serialized = serializeError(cause)
            controller.enqueue(
              encoder.encode(
                `event: error\ndata: ${JSON.stringify(serialized.body)}\n\n`,
              ),
            )
            await cleanup(cause)
          }
        },
        async cancel(reason) {
          await cleanup(reason)
        },
      }),
      {
        headers: {
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'content-type': 'text/event-stream; charset=utf-8',
          'x-accel-buffering': 'no',
        },
      },
    )
  }

  async function readSubscriptionBody(request: Request) {
    if (closing) throw new SpecterTransportClosingError()

    const result = await Promise.race([
      readJsonBody(request).then((body) => ({ kind: 'body' as const, body })),
      closingStarted.then(() => ({ kind: 'closing' as const })),
    ])
    if (result.kind === 'closing') throw new SpecterTransportClosingError()
    return result.body
  }

  async function handleReaction(encodedReactionId: string) {
    const reactionId = decodeURIComponent(encodedReactionId)
    const ticket = await reactionTickets.get(reactionId)
    if (!ticket) {
      return errorResponse(
        404,
        'SPECTER_REACTION_TICKET_NOT_FOUND',
        'Reaction completion ticket was not found or has expired.',
      )
    }

    let result: SettledReaction
    if (ticket.status === 'settled') {
      result = ticket.result
    } else {
      const execution = await run(() =>
        options.app.command(
          ticket.recovery.envelope as SpecterCommandEnvelope<TConfig>,
          ticket.recovery.options,
        ),
      )
      result = await settleReaction(execution.reactions)
      await reactionTickets.settle(reactionId, result)
    }

    if (result.ok) return new Response(null, { status: 204 })
    return serializedErrorResponse(result.error)
  }

  function trackReactionCompletion(
    reactionId: string,
    reactions: Promise<void>,
  ) {
    void settleReaction(reactions)
      .then((result) => reactionTickets.settle(reactionId, result))
      .catch(() => {
        // A durable pending ticket is intentionally recoverable on the next GET.
      })
  }

  return handleSpecterHttpRequest
}

function settleReaction(reactions: Promise<void>) {
  return reactions.then<SettledReaction, SettledReaction>(
    () => ({ ok: true }),
    (cause) => ({ ok: false, error: serializeError(cause) }),
  )
}

async function readJsonBody(request: Request) {
  const contentType = request.headers.get('content-type')
  if (
    !contentType ||
    contentType.split(';', 1)[0]?.trim() !== 'application/json'
  ) {
    throw new SpecterTransportInputError(
      'Request Content-Type must be application/json.',
      undefined,
      415,
      'SPECTER_TRANSPORT_UNSUPPORTED_MEDIA_TYPE',
    )
  }

  let value: unknown
  try {
    value = await request.json()
  } catch (cause) {
    throw new SpecterTransportInputError(
      'Request body must be valid JSON.',
      cause,
    )
  }

  if (!isRecord(value)) {
    throw new SpecterTransportInputError('Request body must be a JSON object.')
  }
  return value
}

class SpecterTransportInputError extends Error {
  readonly status: number
  readonly code: string

  constructor(
    message: string,
    cause?: unknown,
    status = 400,
    code = 'SPECTER_TRANSPORT_INVALID_JSON',
  ) {
    super(message, { cause })
    this.name = 'SpecterTransportInputError'
    this.status = status
    this.code = code
  }
}

class SpecterTransportAccessError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'SpecterTransportAccessError'
    this.code = code
  }
}

class SpecterTransportClosingError extends Error {
  readonly status = 503
  readonly code = 'SPECTER_TRANSPORT_CLOSING'

  constructor() {
    super('Specter transport is shutting down.')
    this.name = 'SpecterTransportClosingError'
  }
}

function validateLocalRequest(
  request: Request,
  allowedOrigins: ReadonlySet<string>,
) {
  const url = new URL(request.url)
  if (!isLoopbackHostname(url.hostname)) {
    throw new SpecterTransportAccessError(
      'SPECTER_TRANSPORT_UNTRUSTED_HOST',
      'Specter transport only accepts loopback hosts.',
    )
  }

  const origin = request.headers.get('origin')
  if (origin) {
    let normalizedOrigin: string
    try {
      normalizedOrigin = new URL(origin).origin
    } catch {
      throw new SpecterTransportAccessError(
        'SPECTER_TRANSPORT_UNTRUSTED_ORIGIN',
        'Specter transport rejected an invalid request origin.',
      )
    }
    if (
      normalizedOrigin !== url.origin &&
      !allowedOrigins.has(normalizedOrigin)
    ) {
      throw new SpecterTransportAccessError(
        'SPECTER_TRANSPORT_UNTRUSTED_ORIGIN',
        'Specter transport rejected a cross-origin request.',
      )
    }
  }

  if (request.headers.get(specterClientHeader) !== specterClientHeaderValue) {
    throw new SpecterTransportAccessError(
      'SPECTER_TRANSPORT_CLIENT_HEADER_REQUIRED',
      'Specter transport client header is missing or invalid.',
    )
  }
}

function isLoopbackHostname(hostname: string) {
  return (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  )
}

function serializeError(cause: unknown): SerializedError {
  if (cause instanceof SpecterTransportAccessError) {
    return {
      status: 403,
      body: { error: { code: cause.code, message: cause.message } },
    }
  }

  if (cause instanceof ReactionRunFailure) {
    return {
      status: 502,
      body: {
        error: {
          code: cause.code,
          message: cause.message,
          details: {
            failedSlices: cause.failures.map(({ sliceName }) => sliceName),
          },
        },
      },
    }
  }

  if (cause instanceof SpecterError) {
    return {
      status: statusForCode(cause.code),
      body: {
        error: {
          code: cause.code,
          message: cause.message,
          details: publicDetails(cause),
        },
      },
    }
  }

  if (cause instanceof SpecterTransportClosingError) {
    return {
      status: cause.status,
      body: { error: { code: cause.code, message: cause.message } },
    }
  }

  if (
    cause instanceof SpecterTransportInputError ||
    cause instanceof TypeError
  ) {
    return {
      status: cause instanceof SpecterTransportInputError ? cause.status : 400,
      body: {
        error: {
          code:
            cause instanceof SpecterTransportInputError
              ? cause.code
              : 'SPECTER_TRANSPORT_INVALID_JSON',
          message: cause.message,
        },
      },
    }
  }

  return {
    status: 500,
    body: {
      error: {
        code: specterErrorCodes.infrastructureFailure,
        message: 'Unexpected Specter infrastructure failure.',
      },
    },
  }
}

function publicDetails(error: SpecterError): JsonValue | undefined {
  const candidate = error as SpecterError & Record<string, unknown>
  const details: Record<string, JsonValue> = {}

  for (const key of [
    'commandType',
    'queryType',
    'operationKind',
    'operationType',
    'expectedVersion',
    'actualVersion',
    'idempotencyKey',
    'afterOrder',
    'receivedOrders',
  ]) {
    const value = candidate[key]
    try {
      assertJsonCompatible(value)
      details[key] = value
    } catch {
      // Causes and other non-JSON internals never cross the transport boundary.
    }
  }

  return Object.keys(details).length > 0 ? details : undefined
}

function statusForCode(code: string) {
  switch (code) {
    case specterErrorCodes.unknownCommand:
    case specterErrorCodes.unknownQuery:
      return 404
    case specterErrorCodes.commandRejected:
    case specterErrorCodes.idempotencyConflict:
    case specterErrorCodes.versionConflict:
      return 409
    case specterErrorCodes.infrastructureFailure:
      return 500
    default:
      return 400
  }
}

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status })
}

function serializedErrorResponse(error: SerializedError) {
  return Response.json(error.body, { status: error.status })
}
