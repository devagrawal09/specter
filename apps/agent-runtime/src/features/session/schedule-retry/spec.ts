import { createCommandSlice, event } from '@specter-ts/spec'

// session.md, Retry Is Narrow And Observable: "Generic scheduled retry covers
// rate-limit and provider-internal failures, transport failures that are unsent
// or have unknown delivery, and provider output classified as an incomplete
// stream." Which failures are retryable is the Plugin's classification; this
// Command owns the budget and records the backoff. The limit is an input
// (default 3) so each scenario states its budget.
const model = { id: 'scripted', providerID: 'test' }
type Failure = { type: string; message: string; status?: number }
const boom: Failure = { type: 'rate-limit', message: 'slow down', status: 429 }
const started = (sessionID = 'ses_1') =>
  event('session-execution-started', { sessionID })
const executionFailed = (sessionID = 'ses_1') =>
  event('session-execution-failed', { sessionID, error: boom })
const succeeded = (sessionID = 'ses_1') =>
  event('session-execution-succeeded', { sessionID })
const interrupted = (sessionID = 'ses_1') =>
  event('session-execution-interrupted', { sessionID, reason: 'user' })
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
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })
const stepFailed = (assistantMessageID: string, error: Failure = boom) =>
  event('session-step-failed', {
    sessionID: 'ses_1',
    assistantMessageID,
    error,
  })
const retryScheduled = (assistantMessageID: string, attempt: number) =>
  event('session-retry-scheduled', {
    sessionID: 'ses_1',
    assistantMessageID,
    attempt,
    at: 1000,
    error: boom,
  })
const when = (extra: Record<string, unknown> = {}) => ({
  sessionID: 'ses_1',
  assistantMessageID: 'msg_1',
  at: 2000,
  ...extra,
})
// One failed physical attempt followed by a scheduled retry that restarted the
// step: the shape repeated to spend the budget.
const spent = [
  stepStarted('msg_1'),
  stepFailed('msg_1'),
  retryScheduled('msg_1', 1),
  stepStarted('msg_1'),
  stepFailed('msg_1'),
  retryScheduled('msg_1', 2),
  stepStarted('msg_1'),
  stepFailed('msg_1'),
  retryScheduled('msg_1', 3),
  stepStarted('msg_1'),
  stepFailed('msg_1'),
]

export const scheduleRetrySpec = createCommandSlice('scheduleRetry')
  .description(
    'Records the generic backoff before another physical attempt of a failed step (session.md: Retry Is Narrow And Observable: "session.retry.scheduled records generic backoff").',
  )
  .scenarios(
    {
      description:
        'A failed step schedules its first retry: attempt 1, carrying the failure recorded on the step.',
      given: [started(), stepStarted('msg_1'), stepFailed('msg_1')],
      when: when(),
      expect: [
        event('session-retry-scheduled', {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_1',
          attempt: 1,
          at: 2000,
          error: boom,
        }),
      ],
    },
    {
      description:
        'Retries keep counting on the same step: the second retry is attempt 2.',
      given: [
        started(),
        stepStarted('msg_1'),
        stepFailed('msg_1'),
        retryScheduled('msg_1', 1),
        stepStarted('msg_1'),
        stepFailed('msg_1'),
      ],
      when: when(),
      expect: [
        event('session-retry-scheduled', {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_1',
          attempt: 2,
          at: 2000,
          error: boom,
        }),
      ],
    },
    {
      description:
        'The retry carries the latest failure, not the first: "Before durable output, generic retries retain the logical step number and assistant message ID".',
      given: [
        started(),
        stepStarted('msg_1'),
        stepFailed('msg_1'),
        retryScheduled('msg_1', 1),
        stepStarted('msg_1'),
        stepFailed('msg_1', { type: 'transport', message: 'reset' }),
      ],
      when: when(),
      expect: [
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
      description:
        'The default budget is 3 retries: a third retry is still allowed.',
      given: [
        started(),
        stepStarted('msg_1'),
        stepFailed('msg_1'),
        retryScheduled('msg_1', 1),
        stepStarted('msg_1'),
        stepFailed('msg_1'),
        retryScheduled('msg_1', 2),
        stepStarted('msg_1'),
        stepFailed('msg_1'),
      ],
      when: when(),
      expect: [
        event('session-retry-scheduled', {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_1',
          attempt: 3,
          at: 2000,
          error: boom,
        }),
      ],
    },
    {
      description:
        'The default budget is exhausted after 3 retries: the execution must fail instead.',
      given: [started(), ...spent],
      when: when(),
      expect: [],
      reject: { reason: 'Retry limit reached' },
    },
    {
      description: 'An explicit limit of 1 allows one retry.',
      given: [started(), stepStarted('msg_1'), stepFailed('msg_1')],
      when: when({ limit: 1 }),
      expect: [
        event('session-retry-scheduled', {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_1',
          attempt: 1,
          at: 2000,
          error: boom,
        }),
      ],
    },
    {
      description: 'An explicit limit of 1 is exhausted after one retry.',
      given: [
        started(),
        stepStarted('msg_1'),
        stepFailed('msg_1'),
        retryScheduled('msg_1', 1),
        stepStarted('msg_1'),
        stepFailed('msg_1'),
      ],
      when: when({ limit: 1 }),
      expect: [],
      reject: { reason: 'Retry limit reached' },
    },
    {
      description: 'A limit of 0 never retries.',
      given: [started(), stepStarted('msg_1'), stepFailed('msg_1')],
      when: when({ limit: 0 }),
      expect: [],
      reject: { reason: 'Retry limit reached' },
    },
    {
      description: 'A step still in flight has not failed: nothing to retry.',
      given: [started(), stepStarted('msg_1')],
      when: when(),
      expect: [],
      reject: { reason: 'Step not failed' },
    },
    {
      description: 'A step that ended has not failed: nothing to retry.',
      given: [started(), stepStarted('msg_1'), stepEnded('msg_1')],
      when: when(),
      expect: [],
      reject: { reason: 'Step not failed' },
    },
    {
      description: 'A step that was never started has not failed.',
      given: [started()],
      when: when(),
      expect: [],
      reject: { reason: 'Step not failed' },
    },
    {
      description:
        'A failure is retried once: with a retry already scheduled and no new attempt started, a second schedule is rejected.',
      given: [
        started(),
        stepStarted('msg_1'),
        stepFailed('msg_1'),
        retryScheduled('msg_1', 1),
      ],
      when: when(),
      expect: [],
      reject: { reason: 'Step not failed' },
    },
    {
      description:
        'An interrupted execution schedules nothing: later activity or a terminal execution event clears retry state.',
      given: [
        started(),
        stepStarted('msg_1'),
        stepFailed('msg_1'),
        interrupted(),
      ],
      when: when(),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description:
        'A failed execution schedules nothing: exhausted retries fail the execution, and a failed execution is not retried.',
      given: [started(), ...spent, executionFailed()],
      when: when(),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description: 'A settled execution schedules nothing.',
      given: [started(), stepStarted('msg_1'), stepEnded('msg_1'), succeeded()],
      when: when(),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
  )

export default scheduleRetrySpec
