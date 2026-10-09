import { createQuerySlice, event } from '@specter-ts/spec'

const started = () => event('session-execution-started', { sessionID: 'ses_1' })
const stepStarted = (assistantMessageID: string) =>
  event('session-step-started', {
    sessionID: 'ses_1',
    assistantMessageID,
    agent: 'build',
    model: { id: 'scripted', providerID: 'test' },
  })
const succeeded = (continues = false) =>
  event('session-step-settled', {
    sessionID: 'ses_1',
    assistantMessageID: 'msg_1',
    outcome: 'succeeded',
    finish: continues ? 'tool-calls' : 'stop',
    ...(continues ? { continues: true } : {}),
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })
const retried = event('session-step-settled', {
  sessionID: 'ses_1',
  assistantMessageID: 'msg_1',
  outcome: 'failed',
  error: { type: 'transport', message: 'reset' },
  retry: { attempt: 1, at: 1000 },
})

export const stepBoundarySpec = createQuerySlice('stepBoundary')
  .description(
    'Reports the boundary the next step of a Session starts at, and how many steps its execution has started (OC++ runner: an execution starts at an idle boundary; a step that continues is followed at a step boundary; any other step leaves the execution idle).',
  )
  .scenarios(
    {
      description: 'A Session with no events is idle.',
      given: [],
      when: { sessionID: 'ses_1' },
      expect: { boundary: 'idle', stepsInExecution: 0 },
    },
    {
      description: 'A started execution begins at an idle boundary.',
      given: [started()],
      when: { sessionID: 'ses_1' },
      expect: { boundary: 'idle', stepsInExecution: 0 },
    },
    {
      description: 'A step in flight is not a boundary yet.',
      given: [started(), stepStarted('msg_1')],
      when: { sessionID: 'ses_1' },
      expect: { boundary: 'step', stepsInExecution: 1 },
    },
    {
      description:
        'A step that needs no follow-up leaves the execution idle: queued input may enter.',
      given: [started(), stepStarted('msg_1'), succeeded()],
      when: { sessionID: 'ses_1' },
      expect: { boundary: 'idle', stepsInExecution: 1 },
    },
    {
      description:
        'A step whose tool results the model must answer continues: the next step starts at a step boundary.',
      given: [started(), stepStarted('msg_1'), succeeded(true)],
      when: { sessionID: 'ses_1' },
      expect: { boundary: 'step', stepsInExecution: 1 },
    },
    {
      description: 'A retried step is retried at a step boundary.',
      given: [started(), stepStarted('msg_1'), retried],
      when: { sessionID: 'ses_1' },
      expect: { boundary: 'step', stepsInExecution: 1 },
    },
    {
      description: 'A new execution starts idle with no steps.',
      given: [
        started(),
        stepStarted('msg_1'),
        succeeded(true),
        event('session-execution-settled', {
          sessionID: 'ses_1',
          outcome: 'interrupted',
          reason: 'user',
        }),
        started(),
      ],
      when: { sessionID: 'ses_1' },
      expect: { boundary: 'idle', stepsInExecution: 0 },
    },
  )

export default stepBoundarySpec
