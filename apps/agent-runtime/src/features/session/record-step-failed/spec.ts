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
    tokens: zeroTokens,
  })
const stepFailed = (assistantMessageID: string) =>
  event('session-step-failed', {
    sessionID: 'ses_1',
    assistantMessageID,
    error: boom,
  })
const retryScheduled = (assistantMessageID: string, attempt: number) =>
  event('session-retry-scheduled', {
    sessionID: 'ses_1',
    assistantMessageID,
    attempt,
    at: 1000,
    error: boom,
  })

export const recordStepFailedSpec = createCommandSlice('recordStepFailed')
  .description(
    'Records that one physical attempt of an in-flight step failed (session.md: One Step May Have Several Physical Attempts: "Every local and hosted call reaches durable success or failure before the Step publishes its single terminal ended or failed event").',
  )
  .scenarios(
    {
      description: 'A started step fails with its error.',
      given: [started(), stepStarted('msg_1')],
      when: { sessionID: 'ses_1', assistantMessageID: 'msg_1', error: boom },
      expect: [stepFailed('msg_1')],
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
      when: { sessionID: 'ses_1', assistantMessageID: 'msg_1', error: boom },
      expect: [stepFailed('msg_1')],
    },
    {
      description: 'A step that was never started cannot fail.',
      given: [started()],
      when: { sessionID: 'ses_1', assistantMessageID: 'msg_1', error: boom },
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
      when: { sessionID: 'ses_1', assistantMessageID: 'msg_1', error: boom },
      expect: [],
      reject: { reason: 'Step not started' },
    },
    {
      description: 'A step that already ended cannot fail.',
      given: [started(), stepStarted('msg_1'), stepEnded('msg_1')],
      when: { sessionID: 'ses_1', assistantMessageID: 'msg_1', error: boom },
      expect: [],
      reject: { reason: 'Step already ended' },
    },
    {
      description:
        'A failed attempt fails once; a new attempt must be started first.',
      given: [started(), stepStarted('msg_1'), stepFailed('msg_1')],
      when: { sessionID: 'ses_1', assistantMessageID: 'msg_1', error: boom },
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
      when: { sessionID: 'ses_1', assistantMessageID: 'msg_1', error: boom },
      expect: [],
      reject: { reason: 'Step already failed' },
    },
    {
      description:
        'A failed execution records no further step facts: failing its in-flight step is rejected.',
      given: [started(), stepStarted('msg_1'), executionFailed()],
      when: { sessionID: 'ses_1', assistantMessageID: 'msg_1', error: boom },
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description:
        'An interrupted execution records no further step facts: failing its in-flight step is rejected.',
      given: [started(), stepStarted('msg_1'), interrupted()],
      when: { sessionID: 'ses_1', assistantMessageID: 'msg_1', error: boom },
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description:
        'A settled execution records no further step facts: a succeeded execution cannot fail a step.',
      given: [started(), stepStarted('msg_1'), stepEnded('msg_1'), succeeded()],
      when: { sessionID: 'ses_1', assistantMessageID: 'msg_1', error: boom },
      expect: [],
      reject: { reason: 'Execution not active' },
    },
  )

export default recordStepFailedSpec
