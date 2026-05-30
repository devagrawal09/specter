export class CommandRejectedError extends Error {
  readonly _tag = 'CommandRejectedError'
  readonly reason: string

  constructor(input: { readonly reason: string }) {
    super(input.reason)
    this.name = 'CommandRejectedError'
    this.reason = input.reason
  }
}
