export class ReactionOutboxLeaseLostError extends Error {
  readonly attemptId: string

  constructor(attemptId: string) {
    super(`Reaction outbox attempt is no longer active: ${attemptId}`)
    this.name = 'ReactionOutboxLeaseLostError'
    this.attemptId = attemptId
  }
}
