import { structuredProtocolError } from '@specter-ts/protocol'

export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

export function publicCliErrorMessage(cause: unknown) {
  return cause instanceof UsageError
    ? cause.message
    : structuredProtocolError(cause).message
}
