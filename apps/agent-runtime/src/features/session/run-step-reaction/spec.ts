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
  event('session-execution-succeeded', { sessionID })
const failed = (sessionID: string) =>
  event('session-execution-failed', {
    sessionID,
    error: { type: 'provider', message: 'boom' },
  })
const interrupted = (sessionID: string) =>
  event('session-execution-interrupted', { sessionID, reason: 'user' })
const stepStarted = (sessionID: string, assistantMessageID: string) =>
  event('session-step-started', {
    sessionID,
    assistantMessageID,
    agent: 'build',
    model,
  })
const stepEnded = (sessionID: string, assistantMessageID: string) =>
  event('session-step-ended', {
    sessionID,
    assistantMessageID,
    finish: 'tool-calls',
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
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
  )

export default runStepSpec
