import { createCommandSlice, event } from '@specter-ts/spec'

const model = { id: 'scripted', providerID: 'test' }
const zeroTokens = {
  input: 0,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
}
const boom = { type: 'transport', message: 'connection reset' }
const started = (sessionID = 'ses_1') =>
  event('session-execution-started', { sessionID })
const executionFailed = (sessionID = 'ses_1') =>
  event('session-execution-settled', {
    sessionID,
    outcome: 'failed',
    error: boom,
  })
const succeeded = (sessionID = 'ses_1') =>
  event('session-execution-settled', { sessionID, outcome: 'succeeded' })
const interrupted = (sessionID = 'ses_1') =>
  event('session-execution-settled', {
    sessionID,
    outcome: 'interrupted',
    reason: 'user',
  })
const stepStarted = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-step-started', {
    sessionID,
    assistantMessageID,
    agent: 'build',
    model,
  })
const stepEnded = (assistantMessageID: string) =>
  event('session-step-ended', {
    sessionID: 'ses_1',
    assistantMessageID,
    finish: 'stop',
    cost: 0,
    tokens: zeroTokens,
  })
const stepFailed = (assistantMessageID: string) =>
  event('session-step-failed', {
    sessionID: 'ses_1',
    assistantMessageID,
    error: boom,
  })
const retryScheduled = (
  assistantMessageID: string,
  attempt: number,
  at = 1000,
) =>
  event('session-retry-scheduled', {
    sessionID: 'ses_1',
    assistantMessageID,
    attempt,
    at,
    error: boom,
  })
const failedExecution = (
  error: { type: string; message: string; status?: number } = boom,
) =>
  event('session-execution-settled', {
    sessionID: 'ses_1',
    outcome: 'failed',
    error,
  })
const call = (extra: Record<string, unknown> = {}) => ({
  sessionID: 'ses_1',
  assistantMessageID: 'msg_1',
  error: boom,
  retryable: true,
  at: 2000,
  ...extra,
})
// One failed physical attempt followed by its scheduled retry and the restarted
// step: repeated to spend the budget.
const retried = (attempt: number) => [
  stepFailed('msg_1'),
  retryScheduled('msg_1', attempt),
  stepStarted('msg_1'),
]

export const recordStepFailedSpec = createCommandSlice('recordStepFailed')
  .description(
    'Records that one physical attempt of an in-flight step failed and, in the same commit, what follows (session.md: One Step May Have Several Physical Attempts: "Every local and hosted call reaches durable success or failure before the Step publishes its single terminal ended or failed event"). Which failures are retryable is the caller\'s classification; this Command owns the budget (limit, default 3) and the outcome: a scheduled retry, or the execution failing.',
  )
  .scenarios(
    {
      description:
        'A retryable failure within budget schedules the retry atomically (session.md, Retry Is Narrow And Observable: "session.retry.scheduled records generic backoff"): attempt 1, carrying the failure.',
      given: [started(), stepStarted('msg_1')],
      when: call(),
      expect: [stepFailed('msg_1'), retryScheduled('msg_1', 1, 2000)],
    },
    {
      description:
        'A normalized content-filter finish, raw finish, cost, and tokens are recorded with the failure.',
      given: [started(), stepStarted('msg_1')],
      when: {
        sessionID: 'ses_1',
        assistantMessageID: 'msg_1',
        error: { type: 'content-filter', message: 'blocked', status: 400 },
        finish: 'content-filter',
        rawFinish: 'safety',
        cost: 0.25,
        tokens: zeroTokens,
        retryable: false,
        at: 2000,
      },
      expect: [
        event('session-step-failed', {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_1',
          error: { type: 'content-filter', message: 'blocked', status: 400 },
          finish: 'content-filter',
          rawFinish: 'safety',
          cost: 0.25,
          tokens: zeroTokens,
        }),
        failedExecution({
          type: 'content-filter',
          message: 'blocked',
          status: 400,
        }),
      ],
    },
    {
      description:
        'A retried physical attempt of the same step can fail again: the step id is reused.',
      given: [
        started(),
        stepStarted('msg_1'),
        stepFailed('msg_1'),
        retryScheduled('msg_1', 1),
        stepStarted('msg_1'),
      ],
      when: call(),
      expect: [stepFailed('msg_1'), retryScheduled('msg_1', 2, 2000)],
    },
    {
      description:
        'Retries keep counting on the same step: the third failure schedules attempt 3, still within the default budget of 3.',
      given: [started(), stepStarted('msg_1'), ...retried(1), ...retried(2)],
      when: call(),
      expect: [stepFailed('msg_1'), retryScheduled('msg_1', 3, 2000)],
    },
    {
      description:
        'The default budget is exhausted after 3 retries: the fourth failure fails the execution instead of scheduling attempt 4.',
      given: [
        started(),
        stepStarted('msg_1'),
        ...retried(1),
        ...retried(2),
        ...retried(3),
      ],
      when: call(),
      expect: [stepFailed('msg_1'), failedExecution()],
    },
    {
      description: 'An explicit limit of 1 allows one retry.',
      given: [started(), stepStarted('msg_1')],
      when: call({ limit: 1 }),
      expect: [stepFailed('msg_1'), retryScheduled('msg_1', 1, 2000)],
    },
    {
      description:
        'An explicit limit of 1 is exhausted after one retry: the next failure fails the execution.',
      given: [started(), stepStarted('msg_1'), ...retried(1)],
      when: call({ limit: 1 }),
      expect: [stepFailed('msg_1'), failedExecution()],
    },
    {
      description: 'A limit of 0 never retries.',
      given: [started(), stepStarted('msg_1')],
      when: call({ limit: 0 }),
      expect: [stepFailed('msg_1'), failedExecution()],
    },
    {
      description:
        'A non-retryable failure fails the execution in the same commit, with budget to spare.',
      given: [started(), stepStarted('msg_1')],
      when: call({ retryable: false }),
      expect: [stepFailed('msg_1'), failedExecution()],
    },
    {
      description:
        'The retry carries the latest failure, not the first: "Before durable output, generic retries retain the logical step number and assistant message ID".',
      given: [started(), stepStarted('msg_1'), ...retried(1)],
      when: call({ error: { type: 'transport', message: 'reset' } }),
      expect: [
        event('session-step-failed', {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_1',
          error: { type: 'transport', message: 'reset' },
        }),
        event('session-retry-scheduled', {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_1',
          attempt: 2,
          at: 2000,
          error: { type: 'transport', message: 'reset' },
        }),
      ],
    },
    {
      description: 'A step that was never started cannot fail.',
      given: [started()],
      when: call(),
      expect: [],
      reject: { reason: 'Step not started' },
    },
    {
      description: 'A step started in another Session cannot fail here.',
      given: [
        started('ses_1'),
        started('ses_2'),
        stepStarted('msg_1', 'ses_2'),
      ],
      when: call(),
      expect: [],
      reject: { reason: 'Step not started' },
    },
    {
      description: 'A step that already ended cannot fail.',
      given: [started(), stepStarted('msg_1'), stepEnded('msg_1')],
      when: call(),
      expect: [],
      reject: { reason: 'Step already ended' },
    },
    {
      description:
        'A failed attempt fails once; a new attempt must be started first.',
      given: [started(), stepStarted('msg_1'), stepFailed('msg_1')],
      when: call(),
      expect: [],
      reject: { reason: 'Step already failed' },
    },
    {
      description:
        'A step whose retry is scheduled has no attempt in flight: it cannot fail again until a new attempt starts.',
      given: [
        started(),
        stepStarted('msg_1'),
        stepFailed('msg_1'),
        retryScheduled('msg_1', 1),
      ],
      when: call(),
      expect: [],
      reject: { reason: 'Step already failed' },
    },
    {
      description:
        'A failed execution records no further step facts: failing its in-flight step is rejected.',
      given: [started(), stepStarted('msg_1'), executionFailed()],
      when: call(),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description:
        'An interrupted execution records no further step facts: failing its in-flight step is rejected.',
      given: [started(), stepStarted('msg_1'), interrupted()],
      when: call(),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description:
        'A settled execution records no further step facts: a succeeded execution cannot fail a step.',
      given: [started(), stepStarted('msg_1'), stepEnded('msg_1'), succeeded()],
      when: call(),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
  )

export default recordStepFailedSpec
