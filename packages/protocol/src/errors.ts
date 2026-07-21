import type { JsonValue, StructuredError } from './types'

export const protocolErrorCodes = {
  invalidJson: 'SPECTER_INVALID_JSON',
  invalidMessage: 'SPECTER_INVALID_MESSAGE',
  versionMismatch: 'SPECTER_PROTOCOL_VERSION_MISMATCH',
  routeNotFound: 'SPECTER_ROUTE_NOT_FOUND',
  internal: 'SPECTER_INTERNAL_ERROR',
  transport: 'SPECTER_TRANSPORT_FAILURE',
} as const

export class SpecterProtocolError extends Error {
  readonly code: string
  readonly status: number
  readonly details?: JsonValue

  constructor(input: {
    readonly code: string
    readonly message: string
    readonly status?: number
    readonly details?: JsonValue
    readonly cause?: unknown
  }) {
    super(input.message, { cause: input.cause })
    this.name = 'SpecterProtocolError'
    this.code = input.code
    this.status = input.status ?? 400
    this.details = input.details
  }

  toStructuredError(): StructuredError {
    return structuredProtocolError(this)
  }
}

const publicRuntimeErrorMessages: Readonly<Record<string, string>> = {
  SPECTER_COMMAND_REJECTED: 'Command was rejected.',
  SPECTER_CONFORMANCE_FAILED: 'Runtime conformance failed.',
  SPECTER_EVENT_LOG_ORDER_VIOLATION: 'Event Log ordering is invalid.',
  SPECTER_IDEMPOTENCY_CONFLICT:
    'The idempotency key conflicts with an earlier Command.',
  SPECTER_INFRASTRUCTURE_FAILURE: 'Runtime operation failed.',
  SPECTER_INVALID_COMMAND_OPTIONS: 'Command options are invalid.',
  SPECTER_INVALID_INPUT: 'Operation input is invalid.',
  SPECTER_INVALID_OUTPUT: 'Operation output is invalid.',
  SPECTER_REACTION_FAILURE: 'One or more Reactions failed.',
  SPECTER_UNKNOWN_COMMAND: 'Command type is not registered.',
  SPECTER_UNKNOWN_EVENT: 'Event type is not registered.',
  SPECTER_UNKNOWN_QUERY: 'Query type is not registered.',
  SPECTER_VERSION_CONFLICT: 'Event Log version conflict.',
}

const publicProtocolErrorMessages: Readonly<Record<string, string>> = {
  [protocolErrorCodes.invalidJson]: 'Malformed JSON request.',
  [protocolErrorCodes.invalidMessage]: 'Protocol message is invalid.',
  [protocolErrorCodes.versionMismatch]:
    'The protocol major version is unsupported.',
  [protocolErrorCodes.routeNotFound]: 'Route not found.',
  [protocolErrorCodes.internal]:
    'The Specter runtime could not complete the request.',
  [protocolErrorCodes.transport]: 'The protocol transport failed.',
}

/** Maps an untrusted runtime failure to a public, non-sensitive protocol error. */
export function structuredProtocolError(cause: unknown): StructuredError {
  if (cause instanceof SpecterProtocolError) {
    const code = Object.hasOwn(publicProtocolErrorMessages, cause.code)
      ? cause.code
      : protocolErrorCodes.internal
    return { code, message: publicProtocolErrorMessages[code] }
  }

  const code =
    cause instanceof Error &&
    'code' in cause &&
    typeof cause.code === 'string' &&
    Object.hasOwn(publicRuntimeErrorMessages, cause.code)
      ? cause.code
      : protocolErrorCodes.internal

  return {
    code,
    message:
      publicRuntimeErrorMessages[code] ??
      'The Specter runtime could not complete the request.',
  }
}
