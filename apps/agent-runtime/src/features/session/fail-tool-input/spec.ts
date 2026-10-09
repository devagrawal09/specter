import { createCommandSlice, event } from '@specter-ts/spec'

// A call the model began but that never became a call: its input stopped
// streaming, or never parsed. It fails as one fact, with what input there was.
const model = { id: 'scripted', providerID: 'test' }
const started = () => event('session-execution-started', { sessionID: 'ses_1' })
const interrupted = () =>
  event('session-execution-settled', {
    sessionID: 'ses_1',
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
const malformed = {
  type: 'tool.input-json',
  message:
    'Tool call arguments were malformed JSON and were not executed. Retry with valid JSON.',
}
const failure = (extra: Record<string, unknown> = {}) => ({
  sessionID: 'ses_1',
  assistantMessageID: 'msg_1',
  id: 'call_1',
  name: 'echo',
  error: malformed,
  ...extra,
})

export const failToolInputSpec = createCommandSlice('failToolInput')
  .description(
    'Fails a tool call whose input never became a call (it stopped streaming, or never parsed), with the raw input it had.',
  )
  .scenarios(
    {
      description:
        'Malformed input fails the call it was for, with its raw text; nothing ran.',
      given: [started(), stepStarted('msg_1')],
      when: failure({ text: '{"text":' }),
      expect: [
        event('session-tool-input-failed', {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_1',
          id: 'call_1',
          name: 'echo',
          error: malformed,
          executed: false,
          text: '{"text":',
        }),
      ],
    },
    {
      description:
        'Input that stopped streaming fails without text when none finished.',
      given: [started(), stepStarted('msg_1')],
      when: failure({
        error: { type: 'aborted', message: 'Step interrupted' },
      }),
      expect: [
        event('session-tool-input-failed', {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_1',
          id: 'call_1',
          name: 'echo',
          error: { type: 'aborted', message: 'Step interrupted' },
          executed: false,
        }),
      ],
    },
    {
      description: 'A call that was requested is settled, not failed here.',
      given: [
        started(),
        stepStarted('msg_1'),
        event('session-tool-requested', {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_1',
          id: 'call_1',
          name: 'echo',
          input: {},
          executed: false,
        }),
      ],
      when: failure(),
      expect: [],
      reject: { reason: 'Tool call already recorded' },
    },
    {
      description: 'A call fails as input once.',
      given: [
        started(),
        stepStarted('msg_1'),
        event('session-tool-input-failed', {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_1',
          id: 'call_1',
          name: 'echo',
          error: malformed,
          executed: false,
        }),
      ],
      when: failure(),
      expect: [],
      reject: { reason: 'Tool call already recorded' },
    },
    {
      description: 'A settled step records no more calls.',
      given: [
        started(),
        stepStarted('msg_1'),
        event('session-step-settled', {
          sessionID: 'ses_1',
          assistantMessageID: 'msg_1',
          outcome: 'succeeded',
          finish: 'stop',
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        }),
      ],
      when: failure(),
      expect: [],
      reject: { reason: 'Step not in flight' },
    },
    {
      description: 'Only the in-flight step records its calls.',
      given: [started(), stepStarted('msg_2')],
      when: failure(),
      expect: [],
      reject: { reason: 'Step not in flight' },
    },
    {
      description: 'An interrupted execution records nothing more.',
      given: [started(), stepStarted('msg_1'), interrupted()],
      when: failure(),
      expect: [],
      reject: { reason: 'Execution not active' },
    },
  )

export default failToolInputSpec
