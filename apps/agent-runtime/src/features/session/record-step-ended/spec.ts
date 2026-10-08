import { createCommandSlice, event } from '@specter-ts/spec'

const model = { id: 'scripted', providerID: 'test' }
const zeroTokens = {
  input: 0,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
}
const started = (sessionID = 'ses_1') =>
  event('session-execution-started', { sessionID })
const failed = (sessionID = 'ses_1') =>
  event('session-execution-failed', {
    sessionID,
    error: { type: 'provider', message: 'boom' },
  })
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
const stepEnded = (
  assistantMessageID: string,
  finish: string,
  sessionID = 'ses_1',
) =>
  event('session-step-ended', {
    sessionID,
    assistantMessageID,
    finish,
    cost: 0,
    tokens: zeroTokens,
  })

export const recordStepEndedSpec = createCommandSlice('recordStepEnded')
  .description(
    'Records that an in-flight step ended with a finish reason (session.md: One Step May Have Several Physical Attempts).',
  )
  .scenarios(
    {
      description:
        'A started step ends with its finish reason; cost and tokens default to zero.',
      given: [started(), stepStarted('msg_1')],
      when: { sessionID: 'ses_1', assistantMessageID: 'msg_1', finish: 'stop' },
      expect: [stepEnded('msg_1', 'stop')],
    },
    {
      description: 'A tool-calls finish is recorded as such.',
      given: [started(), stepStarted('msg_1')],
      when: {
        sessionID: 'ses_1',
        assistantMessageID: 'msg_1',
        finish: 'tool-calls',
      },
      expect: [stepEnded('msg_1', 'tool-calls')],
    },
    {
      description: 'Reported cost and token usage are recorded with the step.',
      given: [started(), stepStarted('msg_1')],
      when: {
        sessionID: 'ses_1',
        assistantMessageID: 'msg_1',
        finish: 'stop',
        cost: 0.5,
        tokens: {
          input: 10,
          output: 4,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
      },
      expect: [
        event('session-step-ended', {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_1',
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
      description: 'A step that was never started cannot end.',
      given: [started()],
      when: { sessionID: 'ses_1', assistantMessageID: 'msg_1', finish: 'stop' },
      expect: [],
      reject: { reason: 'Step not started' },
    },
    {
      description: 'A step started in another Session cannot be ended here.',
      given: [
        started('ses_1'),
        started('ses_2'),
        stepStarted('msg_1', 'ses_2'),
      ],
      when: { sessionID: 'ses_1', assistantMessageID: 'msg_1', finish: 'stop' },
      expect: [],
      reject: { reason: 'Step not started' },
    },
    {
      description: 'A step ends once.',
      given: [started(), stepStarted('msg_1'), stepEnded('msg_1', 'stop')],
      when: { sessionID: 'ses_1', assistantMessageID: 'msg_1', finish: 'stop' },
      expect: [],
      reject: { reason: 'Step already ended' },
    },
    {
      description:
        'An interrupted execution records no further step facts: ending its in-flight step is rejected.',
      given: [started(), stepStarted('msg_1'), interrupted()],
      when: { sessionID: 'ses_1', assistantMessageID: 'msg_1', finish: 'stop' },
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description:
        'A settled execution records no further step facts: a succeeded execution cannot end a step.',
      given: [
        started(),
        stepStarted('msg_1'),
        stepEnded('msg_1', 'stop'),
        succeeded(),
      ],
      when: { sessionID: 'ses_1', assistantMessageID: 'msg_1', finish: 'stop' },
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description:
        'A failed execution records no further step facts: ending its in-flight step is rejected.',
      given: [started(), stepStarted('msg_1'), failed()],
      when: { sessionID: 'ses_1', assistantMessageID: 'msg_1', finish: 'stop' },
      expect: [],
      reject: { reason: 'Execution not active' },
    },
  )

export default recordStepEndedSpec
