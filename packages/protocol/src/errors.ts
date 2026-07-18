import type { JsonValue, StructuredError } from './types'

export const protocolErrorCodes = {
  invalidJson: 'SPECTER_INVALID_JSON',
  invalidMessage: 'SPECTER_INVALID_MESSAGE',
  versionMismatch: 'SPECTER_PROTOCOL_VERSION_MISMATCH',
  unsupportedCapability: 'SPECTER_UNSUPPORTED_CAPABILITY',
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
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    }
  }
}
