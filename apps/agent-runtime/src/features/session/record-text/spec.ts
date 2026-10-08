import { createCommandSlice, event } from '@specter-ts/spec'

// session.md: assistant output is durable as the step produces it. A text
// block is recorded as OC++ publishes it: text.started then text.ended with
// the block's ordinal and final text. Deltas are ephemeral and never recorded.
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
    finish: 'stop',
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
const textStarted = (
  assistantMessageID: string,
  ordinal: number,
  sessionID = 'ses_1',
) => event('session-text-started', { sessionID, assistantMessageID, ordinal })
const textEnded = (
  assistantMessageID: string,
  ordinal: number,
  text: string,
  sessionID = 'ses_1',
) =>
  event('session-text-ended', { sessionID, assistantMessageID, ordinal, text })
const text = (
  assistantMessageID: string,
  ordinal: number,
  value: string,
  sessionID = 'ses_1',
) => ({ sessionID, assistantMessageID, ordinal, text: value })

export const recordTextSpec = createCommandSlice('recordText')
  .description(
    'Records one finished text block of the in-flight step as text.started and text.ended (session.md: durable assistant output; deltas stay ephemeral).',
  )
  .scenarios(
    {
      description:
        'The in-flight step gets a text block: started and ended with its ordinal and text, in one commit.',
      given: [started(), stepStarted('msg_1')],
      when: text('msg_1', 0, 'hello'),
      expect: [textStarted('msg_1', 0), textEnded('msg_1', 0, 'hello')],
    },
    {
      description:
        'A second block with the next ordinal is recorded after the first.',
      given: [
        started(),
        stepStarted('msg_1'),
        textStarted('msg_1', 0),
        textEnded('msg_1', 0, 'one'),
      ],
      when: text('msg_1', 1, 'two'),
      expect: [textStarted('msg_1', 1), textEnded('msg_1', 1, 'two')],
    },
    {
      description:
        'A block ordinal is used once per attempt: recording it again is rejected, which makes a duplicate request harmless.',
      given: [
        started(),
        stepStarted('msg_1'),
        textStarted('msg_1', 0),
        textEnded('msg_1', 0, 'one'),
      ],
      when: text('msg_1', 0, 'one again'),
      expect: [],
      reject: { reason: 'Text already recorded' },
    },
    {
      description:
        'A retried attempt starts its ordinals over: ordinal 0 is free again after the new step.started.',
      given: [
        started(),
        stepStarted('msg_1'),
        textStarted('msg_1', 0),
        textEnded('msg_1', 0, 'partial'),
        stepFailed('msg_1'),
        retryScheduled('msg_1'),
        stepStarted('msg_1'),
      ],
      when: text('msg_1', 0, 'complete'),
      expect: [textStarted('msg_1', 0), textEnded('msg_1', 0, 'complete')],
    },
    {
      description: 'Empty text is not a block.',
      given: [started(), stepStarted('msg_1')],
      when: text('msg_1', 0, ''),
      expect: [],
      reject: { reason: 'Text is empty' },
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

export default recordTextSpec
