export type ReactionRunFailureDetail = {
  readonly sliceName: string
  readonly cause: unknown
}

export class ReactionRunFailure extends AggregateError {
  readonly failures: readonly ReactionRunFailureDetail[]

  constructor(failures: readonly ReactionRunFailureDetail[]) {
    super(
      failures.map(({ cause }) => cause),
      reactionRunFailureMessage(failures),
    )
    this.name = 'ReactionRunFailure'
    this.failures = failures
  }
}

function reactionRunFailureMessage(
  failures: readonly ReactionRunFailureDetail[],
) {
  const sliceNames = [...new Set(failures.map(({ sliceName }) => sliceName))]

  return `Reaction run failed for: ${sliceNames.join(', ')}`
}
