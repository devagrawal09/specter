import { createReactionSlice, event } from '@specter-ts/spec'

// State-derived (findings: Reactions decide from state, not from a trigger):
// any Session whose execution is active and has no step in flight needs a
// runStep request. The request carries the number of steps already started, so
// a duplicate request for the same boundary is recognisably stale. What the
// plugin does with the request is covered by session.integration.test.ts.
const model = { id: 'scripted', providerID: 'test' }
const started = (sessionID: string) =>
  event('session-execution-started', { sessionID })
const succeeded = (sessionID: string) =>
  event('session-execution-settled', { sessionID, outcome: 'succeeded' })
const failed = (sessionID: string) =>
  event('session-execution-settled', {
    sessionID,
    outcome: 'failed',
    error: { type: 'provider', message: 'boom' },
  })
const interrupted = (sessionID: string) =>
  event('session-execution-settled', {
    sessionID,
    outcome: 'interrupted',
    reason: 'user',
  })
const stepStarted = (sessionID: string, assistantMessageID: string) =>
  event('session-step-started', {
    sessionID,
    assistantMessageID,
    agent: 'build',
    model,
  })
const stepEnded = (sessionID: string, assistantMessageID: string) =>
  event('session-step-settled', {
    sessionID,
    assistantMessageID,
    outcome: 'succeeded',
    finish: 'tool-calls',
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })
const stepFailed = (sessionID: string, assistantMessageID: string) =>
  event('session-step-settled', {
    sessionID,
    assistantMessageID,
    outcome: 'failed',
    error: { type: 'transport', message: 'connection reset' },
  })
const stepRetried = (sessionID: string, assistantMessageID: string) =>
  event('session-step-settled', {
    sessionID,
    assistantMessageID,
    outcome: 'failed',
    error: { type: 'transport', message: 'connection reset' },
    retry: { attempt: 1, at: 1000 },
  })
const run = (sessionID: string, ordinal: number) => ({
  type: 'runStep',
  payload: { sessionID, ordinal },
})

export const runStepSpec = createReactionSlice('runStep')
  .description(
    'Requests the next step for every Session with an active execution and no step in flight.',
  )
  .scenarios(
    {
      description:
        "A fresh retry runs as the next step, because the failed attempt's output stands: the next ordinal is requested.",
      given: [
        started('ses_1'),
        stepStarted('ses_1', 'msg_step_0'),
        event('session-step-settled', {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_step_0',
          outcome: 'failed',
          error: { type: 'transport', message: 'connection reset' },
          retry: { attempt: 1, at: 1000, fresh: true },
        }),
      ],
      expect: [run('ses_1', 1)],
    },
    {
      description:
        'A step still in flight when an execution starts belongs to a process that is gone: its ordinal is requested again, so a job reconciles it.',
      given: [stepStarted('ses_1', 'msg_step_0'), started('ses_1')],
      expect: [run('ses_1', 0)],
    },
    {
      description: 'A started execution needs its first step.',
      given: [started('ses_1')],
      expect: [run('ses_1', 0)],
    },
    {
      description: 'A step in flight needs nothing.',
      given: [started('ses_1'), stepStarted('ses_1', 'msg_1')],
      expect: [],
    },
    {
      description:
        'A step that ended inside an active execution needs the next step.',
      given: [
        started('ses_1'),
        stepStarted('ses_1', 'msg_1'),
        stepEnded('ses_1', 'msg_1'),
      ],
      expect: [run('ses_1', 1)],
    },
    {
      description: 'A succeeded execution is settled: nothing to run.',
      given: [
        started('ses_1'),
        stepStarted('ses_1', 'msg_1'),
        stepEnded('ses_1', 'msg_1'),
        succeeded('ses_1'),
      ],
      expect: [],
    },
    {
      description: 'A failed execution is settled: nothing to run.',
      given: [started('ses_1'), failed('ses_1')],
      expect: [],
    },
    {
      description:
        'An interrupted execution is settled, even with a step in flight: nothing to run.',
      given: [
        started('ses_1'),
        stepStarted('ses_1', 'msg_1'),
        interrupted('ses_1'),
      ],
      expect: [],
    },
    {
      description: 'A new execution continues the step count of its Session.',
      given: [
        started('ses_1'),
        stepStarted('ses_1', 'msg_1'),
        stepEnded('ses_1', 'msg_1'),
        succeeded('ses_1'),
        started('ses_1'),
      ],
      expect: [run('ses_1', 1)],
    },
    {
      description:
        'Sessions are independent: ses_1 in flight does not hide the active ses_2.',
      given: [
        started('ses_1'),
        started('ses_2'),
        stepStarted('ses_1', 'msg_1'),
      ],
      expect: [run('ses_2', 0)],
    },
    {
      description:
        'A failed step with no retry scheduled needs nothing: it still holds the boundary until the execution fails.',
      given: [
        started('ses_1'),
        stepStarted('ses_1', 'msg_1'),
        stepFailed('ses_1', 'msg_1'),
      ],
      expect: [],
    },
    {
      description:
        'A failed step whose retry was scheduled needs another attempt of the same step: the ordinal repeats.',
      given: [
        started('ses_1'),
        stepStarted('ses_1', 'msg_1'),
        stepRetried('ses_1', 'msg_1'),
      ],
      expect: [run('ses_1', 0)],
    },
    {
      description:
        "A retry of a later step repeats that step's ordinal, not the next one.",
      given: [
        started('ses_1'),
        stepStarted('ses_1', 'msg_1'),
        stepEnded('ses_1', 'msg_1'),
        stepStarted('ses_1', 'msg_2'),
        stepRetried('ses_1', 'msg_2'),
      ],
      expect: [run('ses_1', 1)],
    },
    {
      description:
        'A retried attempt in flight needs nothing, and ending it moves on to the next ordinal.',
      given: [
        started('ses_1'),
        stepStarted('ses_1', 'msg_1'),
        stepRetried('ses_1', 'msg_1'),
        stepStarted('ses_1', 'msg_1'),
        stepEnded('ses_1', 'msg_1'),
      ],
      expect: [run('ses_1', 1)],
    },
    {
      description:
        'A failed step whose execution then failed (retries exhausted) is settled: nothing to run.',
      given: [
        started('ses_1'),
        stepStarted('ses_1', 'msg_1'),
        stepFailed('ses_1', 'msg_1'),
        failed('ses_1'),
      ],
      expect: [],
    },
  )

export default runStepSpec
