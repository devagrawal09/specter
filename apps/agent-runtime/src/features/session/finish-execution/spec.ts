import { createCommandSlice, event } from '@specter-ts/spec'

const model = { id: 'scripted', providerID: 'test' }
const started = (sessionID = 'ses_1') =>
  event('session-execution-started', { sessionID })
const succeeded = (sessionID = 'ses_1') =>
  event('session-execution-settled', { sessionID, outcome: 'succeeded' })
const failed = (sessionID = 'ses_1') =>
  event('session-execution-settled', {
    sessionID,
    outcome: 'failed',
    error: { type: 'provider', message: 'boom' },
  })
const interrupted = (sessionID = 'ses_1') =>
  event('session-execution-settled', {
    sessionID,
    outcome: 'interrupted',
    reason: 'user',
  })
const stepStarted = (assistantMessageID: string) =>
  event('session-step-started', {
    sessionID: 'ses_1',
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

export const finishExecutionSpec = createCommandSlice('finishExecution')
  .description(
    'Ends the busy period successfully once no step is in flight (session.md: Execution Is Process-Local). Failure is not recorded here: recordStepFailed owns the failure outcome.',
  )
  .scenarios(
    {
      description: 'An active execution with all steps ended succeeds.',
      given: [started(), stepStarted('msg_1'), stepEnded('msg_1')],
      when: { sessionID: 'ses_1' },
      expect: [succeeded()],
    },
    {
      description: 'Success cannot be recorded while a step is in flight.',
      given: [started(), stepStarted('msg_1')],
      when: { sessionID: 'ses_1' },
      expect: [],
      reject: { reason: 'Step in flight' },
    },
    {
      description: 'A Session without an active execution cannot finish.',
      given: [],
      when: { sessionID: 'ses_1' },
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description:
        'An interrupted execution is settled: it cannot also succeed.',
      given: [started(), interrupted()],
      when: { sessionID: 'ses_1' },
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description: 'A succeeded execution cannot succeed twice.',
      given: [started(), succeeded()],
      when: { sessionID: 'ses_1' },
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description: 'A failed execution cannot finish again.',
      given: [started(), failed()],
      when: { sessionID: 'ses_1' },
      expect: [],
      reject: { reason: 'Execution not active' },
    },
  )

export default finishExecutionSpec
