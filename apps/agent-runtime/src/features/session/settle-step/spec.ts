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
const succeeded = (sessionID = 'ses_1') =>
  event('session-execution-settled', { sessionID, outcome: 'succeeded' })
const interrupted = (sessionID = 'ses_1') =>
  event('session-execution-settled', {
    sessionID,
    outcome: 'interrupted',
    reason: 'user',
  })
const failedExecution = (
  error: { type: string; message: string; status?: number } = boom,
) =>
  event('session-execution-settled', {
    sessionID: 'ses_1',
    outcome: 'failed',
    error,
  })
const stepStarted = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-step-started', {
    sessionID,
    assistantMessageID,
    agent: 'build',
    model,
  })
const stepSucceeded = (assistantMessageID: string, finish = 'stop') =>
  event('session-step-settled', {
    sessionID: 'ses_1',
    assistantMessageID,
    outcome: 'succeeded',
    finish,
    cost: 0,
    tokens: zeroTokens,
  })
const stepFailed = (
  assistantMessageID: string,
  retry?: { attempt: number; at: number; fresh?: true },
) =>
  event('session-step-settled', {
    sessionID: 'ses_1',
    assistantMessageID,
    outcome: 'failed',
    error: boom,
    ...(retry ? { retry } : {}),
  })
const success = (extra: Record<string, unknown> = {}) => ({
  sessionID: 'ses_1',
  assistantMessageID: 'msg_1',
  outcome: 'succeeded',
  finish: 'stop',
  ...extra,
})
const failure = (extra: Record<string, unknown> = {}) => ({
  sessionID: 'ses_1',
  assistantMessageID: 'msg_1',
  outcome: 'failed',
  error: boom,
  retryable: true,
  at: 2000,
  ...extra,
})
// One failed physical attempt with its retry, then the restarted step:
// repeated to spend the budget.
const retried = (attempt: number) => [
  stepFailed('msg_1', { attempt, at: 1000 }),
  stepStarted('msg_1'),
]

export const settleStepSpec = createCommandSlice('settleStep')
  .description(
    'Records the single terminal fact of one physical attempt of an in-flight step (session.md: One Step May Have Several Physical Attempts: "Every local and hosted call reaches durable success or failure before the Step publishes its single terminal ended or failed event"). A success records its finish reason and usage. A failure records, in the same fact, whether the step is retried; which failures are retryable is the caller\'s classification, while this Command owns the budget (limit, default 3) and fails the execution in the same commit once it is spent.',
  )
  .scenarios(
    {
      description:
        "A fresh retry runs as a new step because the failed attempt's output stands; the new step keeps the retry budget the first one spent.",
      given: [
        started(),
        stepStarted('msg_1'),
        stepFailed('msg_1', { attempt: 1, at: 1000, fresh: true }),
        stepStarted('msg_2'),
      ],
      when: failure({ assistantMessageID: 'msg_2', fresh: true }),
      expect: [
        event('session-step-settled', {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_2',
          outcome: 'failed',
          error: boom,
          retry: { attempt: 2, at: 2000, fresh: true },
        }),
      ],
    },
    {
      description:
        'A started step succeeds with its finish reason; cost and tokens default to zero.',
      given: [started(), stepStarted('msg_1')],
      when: success(),
      expect: [stepSucceeded('msg_1')],
    },
    {
      description: 'A tool-calls finish is recorded as such.',
      given: [started(), stepStarted('msg_1')],
      when: success({ finish: 'tool-calls' }),
      expect: [stepSucceeded('msg_1', 'tool-calls')],
    },
    {
      description:
        'A step whose tool results the model must answer records that another step follows.',
      given: [started(), stepStarted('msg_1')],
      when: success({ finish: 'tool-calls', continues: true }),
      expect: [
        event('session-step-settled', {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_1',
          outcome: 'succeeded',
          finish: 'tool-calls',
          continues: true,
          cost: 0,
          tokens: zeroTokens,
        }),
      ],
    },
    {
      description: 'Reported cost and token usage are recorded with the step.',
      given: [started(), stepStarted('msg_1')],
      when: success({
        cost: 0.5,
        tokens: {
          input: 10,
          output: 4,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      }),
      expect: [
        event('session-step-settled', {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_1',
          outcome: 'succeeded',
          finish: 'stop',
          cost: 0.5,
          tokens: {
            input: 10,
            output: 4,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        }),
      ],
    },
    {
      description:
        'What the host observed of the attempt is recorded as given: raw finish, provider state, snapshot and changed files.',
      given: [started(), stepStarted('msg_1')],
      when: success({
        rawFinish: 'end_turn',
        providerState: { openai: { responseID: 'resp_1' } },
        snapshot: 'snap_1',
        files: ['src/a.ts'],
      }),
      expect: [
        event('session-step-settled', {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_1',
          outcome: 'succeeded',
          finish: 'stop',
          rawFinish: 'end_turn',
          providerState: { openai: { responseID: 'resp_1' } },
          snapshot: 'snap_1',
          files: ['src/a.ts'],
          cost: 0,
          tokens: zeroTokens,
        }),
      ],
    },
    {
      description:
        'A retryable failure within budget carries its retry (session.md, Retry Is Narrow And Observable: "session.retry.scheduled records generic backoff"): attempt 1, due at the given time.',
      given: [started(), stepStarted('msg_1')],
      when: failure(),
      expect: [stepFailed('msg_1', { attempt: 1, at: 2000 })],
    },
    {
      description:
        'A normalized content-filter finish, raw finish, cost, and tokens are recorded with the failure.',
      given: [started(), stepStarted('msg_1')],
      when: failure({
        error: { type: 'content-filter', message: 'blocked', status: 400 },
        finish: 'content-filter',
        rawFinish: 'safety',
        cost: 0.25,
        tokens: zeroTokens,
        retryable: false,
      }),
      expect: [
        event('session-step-settled', {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_1',
          outcome: 'failed',
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
        'A retried physical attempt of the same step can fail again: the step id is reused and the retries keep counting.',
      given: [started(), stepStarted('msg_1'), ...retried(1)],
      when: failure(),
      expect: [stepFailed('msg_1', { attempt: 2, at: 2000 })],
    },
    {
      description:
        'The third failure is retried as attempt 3, still within the default budget of 3.',
      given: [started(), stepStarted('msg_1'), ...retried(1), ...retried(2)],
      when: failure(),
      expect: [stepFailed('msg_1', { attempt: 3, at: 2000 })],
    },
    {
      description:
        'The default budget is exhausted after 3 retries: the fourth failure fails the execution instead of retrying.',
      given: [
        started(),
        stepStarted('msg_1'),
        ...retried(1),
        ...retried(2),
        ...retried(3),
      ],
      when: failure(),
      expect: [stepFailed('msg_1'), failedExecution()],
    },
    {
      description: 'An explicit limit of 1 allows one retry.',
      given: [started(), stepStarted('msg_1')],
      when: failure({ limit: 1 }),
      expect: [stepFailed('msg_1', { attempt: 1, at: 2000 })],
    },
    {
      description:
        'An explicit limit of 1 is exhausted after one retry: the next failure fails the execution.',
      given: [started(), stepStarted('msg_1'), ...retried(1)],
      when: failure({ limit: 1 }),
      expect: [stepFailed('msg_1'), failedExecution()],
    },
    {
      description: 'A limit of 0 never retries.',
      given: [started(), stepStarted('msg_1')],
      when: failure({ limit: 0 }),
      expect: [stepFailed('msg_1'), failedExecution()],
    },
    {
      description:
        'A non-retryable failure fails the execution in the same commit, with budget to spare.',
      given: [started(), stepStarted('msg_1')],
      when: failure({ retryable: false }),
      expect: [stepFailed('msg_1'), failedExecution()],
    },
    {
      description:
        'The retry follows the latest failure, not the first: "Before durable output, generic retries retain the logical step number and assistant message ID".',
      given: [started(), stepStarted('msg_1'), ...retried(1)],
      when: failure({ error: { type: 'transport', message: 'reset' } }),
      expect: [
        event('session-step-settled', {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_1',
          outcome: 'failed',
          error: { type: 'transport', message: 'reset' },
          retry: { attempt: 2, at: 2000 },
        }),
      ],
    },
    {
      description: 'A step that was never started cannot settle.',
      given: [started()],
      when: success(),
      expect: [],
      reject: { reason: 'Step not started' },
    },
    {
      description: 'A step started in another Session cannot settle here.',
      given: [
        started('ses_1'),
        started('ses_2'),
        stepStarted('msg_1', 'ses_2'),
      ],
      when: failure(),
      expect: [],
      reject: { reason: 'Step not started' },
    },
    {
      description: 'An attempt settles once: a succeeded step cannot fail.',
      given: [started(), stepStarted('msg_1'), stepSucceeded('msg_1')],
      when: failure(),
      expect: [],
      reject: { reason: 'Step already settled' },
    },
    {
      description:
        'An attempt settles once: a succeeded step cannot succeed again.',
      given: [started(), stepStarted('msg_1'), stepSucceeded('msg_1')],
      when: success(),
      expect: [],
      reject: { reason: 'Step already settled' },
    },
    {
      description:
        'A step whose retry is pending has no attempt in flight: it cannot settle again until a new attempt starts.',
      given: [
        started(),
        stepStarted('msg_1'),
        stepFailed('msg_1', { attempt: 1, at: 1000 }),
      ],
      when: failure(),
      expect: [],
      reject: { reason: 'Step already settled' },
    },
    {
      description:
        'A failed execution records no further step facts: settling its in-flight step is rejected.',
      given: [started(), stepStarted('msg_1'), failedExecution()],
      when: failure(),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description:
        'An interrupted execution records no further step facts: settling its in-flight step is rejected.',
      given: [started(), stepStarted('msg_1'), interrupted()],
      when: success(),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description:
        'A settled execution records no further step facts: a succeeded execution cannot settle a step.',
      given: [
        started(),
        stepStarted('msg_1'),
        stepSucceeded('msg_1'),
        succeeded(),
      ],
      when: success(),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
  )

export default settleStepSpec
