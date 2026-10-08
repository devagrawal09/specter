import { createCommandSlice, event } from '@specter-ts/spec'

// session.md: "Each complete local tool call is durable before side effects
// begin." The call is recorded as OC++ publishes it: tool.input.started,
// tool.input.ended (the raw input text), tool.called (the decoded input).
// Execution happens only after this commit.
const model = { id: 'scripted', providerID: 'test' }
const started = (sessionID = 'ses_1') =>
  event('session-execution-started', { sessionID })
const succeeded = (sessionID = 'ses_1') =>
  event('session-execution-succeeded', { sessionID })
const executionFailed = (sessionID = 'ses_1') =>
  event('session-execution-failed', {
    sessionID,
    error: { type: 'provider', message: 'boom' },
  })
const interrupted = (sessionID = 'ses_1') =>
  event('session-execution-interrupted', { sessionID, reason: 'user' })
const stepStarted = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-step-started', {
    sessionID,
    assistantMessageID,
    agent: 'build',
    model,
  })
const stepEnded = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-step-ended', {
    sessionID,
    assistantMessageID,
    finish: 'tool-calls',
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })
const boom = { type: 'transport', message: 'connection reset' }
const stepFailed = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-step-failed', { sessionID, assistantMessageID, error: boom })
const retryScheduled = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-retry-scheduled', {
    sessionID,
    assistantMessageID,
    attempt: 1,
    at: 1000,
    error: boom,
  })
const inputStarted = (
  assistantMessageID: string,
  id: string,
  name = 'execute',
  sessionID = 'ses_1',
) =>
  event('session-tool-input-started', {
    sessionID,
    assistantMessageID,
    id,
    name,
  })
const inputEnded = (
  assistantMessageID: string,
  id: string,
  text: string,
  sessionID = 'ses_1',
) =>
  event('session-tool-input-ended', { sessionID, assistantMessageID, id, text })
const called = (
  assistantMessageID: string,
  id: string,
  input: Record<string, string>,
  sessionID = 'ses_1',
) =>
  event('session-tool-called', {
    sessionID,
    assistantMessageID,
    id,
    input,
    executed: false,
  })
const recorded = (
  assistantMessageID: string,
  id: string,
  input: Record<string, string>,
  name = 'execute',
  sessionID = 'ses_1',
) =>
  [
    inputStarted(assistantMessageID, id, name, sessionID),
    inputEnded(assistantMessageID, id, JSON.stringify(input), sessionID),
    called(assistantMessageID, id, input, sessionID),
  ] as const
const call = (
  assistantMessageID: string,
  id: string,
  input: Record<string, string>,
  name = 'execute',
  sessionID = 'ses_1',
) => ({ sessionID, assistantMessageID, id, name, input })

export const recordToolCallSpec = createCommandSlice('recordToolCall')
  .description(
    'Records a complete local tool call of the in-flight step before any side effect (session.md: tool-call durability).',
  )
  .scenarios(
    {
      description:
        'A tool call becomes input started, input ended with the raw JSON text, and called with the decoded input, in one commit.',
      given: [started(), stepStarted('msg_1')],
      when: call('msg_1', 'call_1', { code: 'return 1' }),
      expect: recorded('msg_1', 'call_1', { code: 'return 1' }),
    },
    {
      description: 'The tool name is recorded with the call.',
      given: [started(), stepStarted('msg_1')],
      when: call('msg_1', 'call_1', { code: 'x' }, 'lookup'),
      expect: recorded('msg_1', 'call_1', { code: 'x' }, 'lookup'),
    },
    {
      description:
        'A step may record several calls, each with its own call id.',
      given: [
        started(),
        stepStarted('msg_1'),
        ...recorded('msg_1', 'call_1', { code: 'a' }),
      ],
      when: call('msg_1', 'call_2', { code: 'b' }),
      expect: recorded('msg_1', 'call_2', { code: 'b' }),
    },
    {
      description:
        'A call id is recorded once per attempt: a duplicate request is rejected.',
      given: [
        started(),
        stepStarted('msg_1'),
        ...recorded('msg_1', 'call_1', { code: 'a' }),
      ],
      when: call('msg_1', 'call_1', { code: 'a' }),
      expect: [],
      reject: { reason: 'Tool call already recorded' },
    },
    {
      description:
        'A retried attempt may reuse a call id: the new step.started opens a fresh attempt.',
      given: [
        started(),
        stepStarted('msg_1'),
        ...recorded('msg_1', 'call_1', { code: 'a' }),
        stepFailed('msg_1'),
        retryScheduled('msg_1'),
        stepStarted('msg_1'),
      ],
      when: call('msg_1', 'call_1', { code: 'a' }),
      expect: recorded('msg_1', 'call_1', { code: 'a' }),
    },
    {
      description: 'A call needs an active execution.',
      given: [],
      when: call('msg_1', 'call_1', { code: 'a' }),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description:
        'A call after the execution succeeded is rejected: nothing is recorded or run for a settled execution.',
      given: [started(), stepStarted('msg_1'), stepEnded('msg_1'), succeeded()],
      when: call('msg_1', 'call_1', { code: 'a' }),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description:
        'A call after an interrupt is rejected, so an interrupted execution runs no further tools.',
      given: [started(), stepStarted('msg_1'), interrupted()],
      when: call('msg_1', 'call_1', { code: 'a' }),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description: 'A call after the execution failed is rejected.',
      given: [started(), stepStarted('msg_1'), executionFailed()],
      when: call('msg_1', 'call_1', { code: 'a' }),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description: 'A call needs a started step.',
      given: [started()],
      when: call('msg_1', 'call_1', { code: 'a' }),
      expect: [],
      reject: { reason: 'Step not in flight' },
    },
    {
      description: 'A call for an ended step is rejected.',
      given: [started(), stepStarted('msg_1'), stepEnded('msg_1')],
      when: call('msg_1', 'call_1', { code: 'a' }),
      expect: [],
      reject: { reason: 'Step not in flight' },
    },
    {
      description: 'A call for a failed attempt is rejected.',
      given: [started(), stepStarted('msg_1'), stepFailed('msg_1')],
      when: call('msg_1', 'call_1', { code: 'a' }),
      expect: [],
      reject: { reason: 'Step not in flight' },
    },
    {
      description:
        'A call belongs to the in-flight step: another step id is rejected.',
      given: [started(), stepStarted('msg_1')],
      when: call('msg_2', 'call_1', { code: 'a' }),
      expect: [],
      reject: { reason: 'Step not in flight' },
    },
  )

export default recordToolCallSpec
