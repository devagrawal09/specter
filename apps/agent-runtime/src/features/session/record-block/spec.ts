import { createCommandSlice, event } from '@specter-ts/spec'

// session.md: assistant output is durable as the step produces it. A finished
// text or reasoning block is one fact with its kind, ordinal and final text.
// Deltas are ephemeral and never recorded.
const model = { id: 'scripted', providerID: 'test' }
const started = (sessionID = 'ses_1') =>
  event('session-execution-started', { sessionID })
const succeeded = (sessionID = 'ses_1') =>
  event('session-execution-settled', { sessionID, outcome: 'succeeded' })
const executionFailed = (sessionID = 'ses_1') =>
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
    finish: 'stop',
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
const recorded = (
  assistantMessageID: string,
  ordinal: number,
  text: string,
  kind = 'text',
) =>
  event('session-block-recorded', {
    sessionID: 'ses_1',
    assistantMessageID,
    ordinal,
    text,
    kind,
  })
const text = (
  assistantMessageID: string,
  ordinal: number,
  value: string,
  sessionID = 'ses_1',
  kind = 'text',
) => ({ sessionID, assistantMessageID, kind, ordinal, text: value })

export const recordBlockSpec = createCommandSlice('recordBlock')
  .description(
    'Records one finished text or reasoning block of the in-flight step (session.md: durable assistant output; deltas stay ephemeral).',
  )
  .scenarios(
    {
      description:
        'The in-flight step gets a text block with its ordinal and text.',
      given: [started(), stepStarted('msg_1')],
      when: text('msg_1', 0, 'hello'),
      expect: [recorded('msg_1', 0, 'hello')],
    },
    {
      description:
        'A second block with the next ordinal is recorded after the first.',
      given: [started(), stepStarted('msg_1'), recorded('msg_1', 0, 'one')],
      when: text('msg_1', 1, 'two'),
      expect: [recorded('msg_1', 1, 'two')],
    },
    {
      description:
        'A reasoning block counts its ordinals apart from text: reasoning 0 is recorded after text 0.',
      given: [started(), stepStarted('msg_1'), recorded('msg_1', 0, 'one')],
      when: text('msg_1', 0, 'thinking', 'ses_1', 'reasoning'),
      expect: [recorded('msg_1', 0, 'thinking', 'reasoning')],
    },
    {
      description:
        'A block ordinal is used once per attempt: recording it again is rejected, which makes a duplicate request harmless.',
      given: [started(), stepStarted('msg_1'), recorded('msg_1', 0, 'one')],
      when: text('msg_1', 0, 'one again'),
      expect: [],
      reject: { reason: 'Block already recorded' },
    },
    {
      description:
        'A retried attempt starts its ordinals over: ordinal 0 is free again after the new step.started.',
      given: [
        started(),
        stepStarted('msg_1'),
        recorded('msg_1', 0, 'partial'),
        stepRetried('msg_1'),
        stepStarted('msg_1'),
      ],
      when: text('msg_1', 0, 'complete'),
      expect: [recorded('msg_1', 0, 'complete')],
    },
    {
      description: 'An empty block is not recorded.',
      given: [started(), stepStarted('msg_1')],
      when: text('msg_1', 0, ''),
      expect: [],
      reject: { reason: 'Block is empty' },
    },
    {
      description: 'Text needs an active execution.',
      given: [],
      when: text('msg_1', 0, 'hello'),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description: 'Text after the execution succeeded is rejected.',
      given: [started(), stepStarted('msg_1'), stepEnded('msg_1'), succeeded()],
      when: text('msg_1', 0, 'late'),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description:
        'Text after an interrupt is rejected: an interrupted execution records nothing more.',
      given: [started(), stepStarted('msg_1'), interrupted()],
      when: text('msg_1', 0, 'late'),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description: 'Text after the execution failed is rejected.',
      given: [started(), stepStarted('msg_1'), executionFailed()],
      when: text('msg_1', 0, 'late'),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description: 'Text needs a started step.',
      given: [started()],
      when: text('msg_1', 0, 'hello'),
      expect: [],
      reject: { reason: 'Step not in flight' },
    },
    {
      description: 'Text for an ended step is rejected.',
      given: [started(), stepStarted('msg_1'), stepEnded('msg_1')],
      when: text('msg_1', 0, 'late'),
      expect: [],
      reject: { reason: 'Step not in flight' },
    },
    {
      description: 'Text for a failed attempt is rejected.',
      given: [started(), stepStarted('msg_1'), stepFailed('msg_1')],
      when: text('msg_1', 0, 'late'),
      expect: [],
      reject: { reason: 'Step not in flight' },
    },
    {
      description:
        'Text belongs to the in-flight step: another step id is rejected.',
      given: [started(), stepStarted('msg_1')],
      when: text('msg_2', 0, 'hello'),
      expect: [],
      reject: { reason: 'Step not in flight' },
    },
    {
      description:
        "Sessions are independent: another Session's step does not accept the text.",
      given: [
        started(),
        stepStarted('msg_1'),
        started('ses_2'),
        stepStarted('msg_2', 'ses_2'),
      ],
      when: text('msg_1', 0, 'hello', 'ses_2'),
      expect: [],
      reject: { reason: 'Step not in flight' },
    },
  )

export default recordBlockSpec
