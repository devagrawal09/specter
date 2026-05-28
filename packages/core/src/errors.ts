import { Data } from 'effect'

export class CommandRejectedError extends Data.TaggedError(
  'CommandRejectedError',
)<{
  readonly reason: string
}> {}
