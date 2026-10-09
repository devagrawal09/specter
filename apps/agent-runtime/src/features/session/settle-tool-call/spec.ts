import { createCommandSlice, event } from '@specter-ts/spec'

// session.md: tool outcomes are serialized after the call is durable. A
// requested call settles exactly once, succeeded (non-empty content) or failed
// (an error), in one self-contained terminal fact.
const model = { id: 'scripted', providerID: 'test' }
const started = (sessionID = 'ses_1') =>
  event('session-execution-started', { sessionID })
const executionFailed = (sessionID = 'ses_1') =>
  event('session-execution-settled', {
    sessionID,
    outcome: 'failed',
    error: { type: 'provider', message: 'boom' },
  })
const executionSucceeded = (sessionID = 'ses_1') =>
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
const stepEnded = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-step-settled', {
    sessionID,
    assistantMessageID,
    outcome: 'succeeded',
    finish: 'tool-calls',
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })
const boom = { type: 'transport', message: 'connection reset' }
const stepFailed = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-step-settled', {
    sessionID,
    assistantMessageID,
    outcome: 'failed',
    error: boom,
  })
const stepRetried = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-step-settled', {
    sessionID,
    assistantMessageID,
    outcome: 'failed',
    error: boom,
    retry: { attempt: 1, at: 1000 },
  })
const toolCall = (
  assistantMessageID: string,
  id: string,
  sessionID = 'ses_1',
) => [
  event('session-tool-requested', {
    sessionID,
    assistantMessageID,
    id,
    name: 'execute',
    input: { code: '1' },
    executed: false,
  }),
]
const succeeded = (
  assistantMessageID: string,
  id: string,
  value: string,
  sessionID = 'ses_1',
) =>
  event('session-tool-settled', {
    sessionID,
    assistantMessageID,
    id,
    outcome: 'succeeded',
    content: [{ type: 'text', text: value }],
    executed: false,
  })
const failedTool = (
  assistantMessageID: string,
  id: string,
  sessionID = 'ses_1',
) =>
  event('session-tool-settled', {
    sessionID,
    assistantMessageID,
    id,
    outcome: 'failed',
    error: { type: 'tool.execution', message: 'boom' },
    executed: false,
  })
const success = (
  assistantMessageID: string,
  id: string,
  value: string,
  sessionID = 'ses_1',
) => ({
  sessionID,
  assistantMessageID,
  id,
  content: [{ type: 'text', text: value }],
})
const failure = (
  assistantMessageID: string,
  id: string,
  sessionID = 'ses_1',
) => ({
  sessionID,
  assistantMessageID,
  id,
  error: { type: 'tool.execution', message: 'boom' },
})
const abortError = {
  type: 'aborted',
  message: 'Tool execution interrupted: execute',
}
const abort = (
  assistantMessageID: string,
  id: string,
  sessionID = 'ses_1',
) => ({ sessionID, assistantMessageID, id, error: abortError })
const aborted = (
  assistantMessageID: string,
  id: string,
  executed = false,
  sessionID = 'ses_1',
) =>
  event('session-tool-settled', {
    sessionID,
    assistantMessageID,
    id,
    outcome: 'failed',
    error: abortError,
    executed,
  })
const open = [started(), stepStarted('msg_1'), ...toolCall('msg_1', 'call_1')]

export const settleToolCallSpec = createCommandSlice('settleToolCall')
  .description(
    'Settles a recorded tool call of the in-flight step with its content or its error (session.md: tool outcomes after durable calls).',
  )
  .scenarios(
    {
      description: 'A requested call succeeds with its content.',
      given: open,
      when: success('msg_1', 'call_1', '2'),
      expect: [succeeded('msg_1', 'call_1', '2')],
    },
    {
      description: 'A requested call fails with its error.',
      given: open,
      when: failure('msg_1', 'call_1'),
      expect: [failedTool('msg_1', 'call_1')],
    },
    {
      description:
        'A failure may carry the partial content the tool produced before failing.',
      given: open,
      when: {
        ...failure('msg_1', 'call_1'),
        content: [{ type: 'text', text: 'partial' }],
      },
      expect: [
        event('session-tool-settled', {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_1',
          id: 'call_1',
          outcome: 'failed',
          error: { type: 'tool.execution', message: 'boom' },
          content: [{ type: 'text', text: 'partial' }],
          executed: false,
        }),
      ],
    },
    {
      description:
        'Calls settle independently and in any order: the second call settles while the first is still open.',
      given: [...open, ...toolCall('msg_1', 'call_2')],
      when: success('msg_1', 'call_2', 'B'),
      expect: [succeeded('msg_1', 'call_2', 'B')],
    },
    {
      description:
        'A success needs non-empty content (the terminal fact is one non-empty model representation).',
      given: open,
      when: { sessionID: 'ses_1', assistantMessageID: 'msg_1', id: 'call_1' },
      expect: [],
      reject: { reason: 'Success needs content' },
    },
    {
      description:
        'A call settles once: a second outcome is rejected, which makes a duplicate request harmless.',
      given: [...open, succeeded('msg_1', 'call_1', '2')],
      when: success('msg_1', 'call_1', '3'),
      expect: [],
      reject: { reason: 'Tool call already settled' },
    },
    {
      description: 'A failed call cannot then succeed.',
      given: [...open, failedTool('msg_1', 'call_1')],
      when: success('msg_1', 'call_1', '3'),
      expect: [],
      reject: { reason: 'Tool call already settled' },
    },
    {
      description:
        'A call that was never recorded has no outcome: durability comes first.',
      given: [started(), stepStarted('msg_1')],
      when: success('msg_1', 'call_1', '2'),
      expect: [],
      reject: { reason: 'Tool call not recorded' },
    },
    {
      description:
        'A retried attempt forgets the failed attempt calls: its call ids are unknown until recorded again.',
      given: [...open, stepRetried('msg_1'), stepStarted('msg_1')],
      when: success('msg_1', 'call_1', '2'),
      expect: [],
      reject: { reason: 'Tool call not recorded' },
    },
    {
      description: 'An outcome needs an active execution.',
      given: [],
      when: success('msg_1', 'call_1', '2'),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description:
        'An interrupted execution records no further outcomes: a running tool settles nothing after the interrupt.',
      given: [...open, interrupted()],
      when: success('msg_1', 'call_1', '2'),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description: 'An outcome after the execution failed is rejected.',
      given: [...open, executionFailed()],
      when: success('msg_1', 'call_1', '2'),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description: 'An outcome after the execution succeeded is rejected.',
      given: [...open, stepEnded('msg_1'), executionSucceeded()],
      when: success('msg_1', 'call_1', '2'),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description: 'An outcome after the step ended is rejected.',
      given: [...open, stepEnded('msg_1')],
      when: success('msg_1', 'call_1', '2'),
      expect: [],
      reject: { reason: 'Step not in flight' },
    },
    {
      description: 'An outcome after the attempt failed is rejected.',
      given: [...open, stepFailed('msg_1')],
      when: success('msg_1', 'call_1', '2'),
      expect: [],
      reject: { reason: 'Step not in flight' },
    },
    {
      description:
        'An open call is aborted with the type "aborted": the failure carries that error (orphan reconciliation and interrupt settle calls this way).',
      given: open,
      when: abort('msg_1', 'call_1'),
      expect: [aborted('msg_1', 'call_1')],
    },
    {
      description:
        "The executed flag of the outcome is the caller's: an aborted call whose execution had begun says so.",
      given: open,
      when: { ...abort('msg_1', 'call_1'), executed: true },
      expect: [aborted('msg_1', 'call_1', true)],
    },
    {
      description:
        'A call already settled cannot be aborted: a stale reconciliation is harmless.',
      given: [...open, succeeded('msg_1', 'call_1', '2')],
      when: abort('msg_1', 'call_1'),
      expect: [],
      reject: { reason: 'Tool call already settled' },
    },
    {
      description: 'A call already aborted cannot be aborted again.',
      given: [...open, aborted('msg_1', 'call_1')],
      when: abort('msg_1', 'call_1'),
      expect: [],
      reject: { reason: 'Tool call already settled' },
    },
  )

export default settleToolCallSpec
