import { createQuerySlice, event } from '@specter-ts/spec'

const started = () => event('session-execution-started', { sessionID: 'ses_1' })
const enqueued = (inboxID: string, type = 'user') =>
  event('session-inbox-enqueued', {
    sessionID: 'ses_1',
    inboxID,
    item:
      type === 'user'
        ? { type: 'user', payload: { text: 'hi' }, delivery: 'steer' }
        : { type: 'compaction', payload: {}, delivery: 'steer' },
  })
const delivered = (inboxID: string) =>
  event('session-inbox-delivered', { sessionID: 'ses_1', inboxID })
const stepStarted = (assistantMessageID: string) =>
  event('session-step-started', {
    sessionID: 'ses_1',
    assistantMessageID,
    agent: 'build',
    model: { id: 'scripted', providerID: 'test' },
  })
const succeeded = (assistantMessageID: string, continues = false) =>
  event('session-step-settled', {
    sessionID: 'ses_1',
    assistantMessageID,
    outcome: 'succeeded',
    finish: continues ? 'tool-calls' : 'stop',
    ...(continues ? { continues: true } : {}),
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })
const retried = (assistantMessageID: string, at = 1000, fresh = false) =>
  event('session-step-settled', {
    sessionID: 'ses_1',
    assistantMessageID,
    outcome: 'failed',
    error: { type: 'transport', message: 'reset' },
    retry: { attempt: 1, at, ...(fresh ? { fresh: true } : {}) },
  })
const next = (
  boundary: string,
  stepsInExecution: number,
  stepsSinceInput: number,
  retryAt?: number,
  attempt = 1,
) => ({
  boundary,
  stepsInExecution,
  stepsSinceInput,
  ...(retryAt === undefined ? {} : { retryAt }),
  attempt,
})

export const nextStepSpec = createQuerySlice('nextStep')
  .description(
    "Reports what the next step of a Session's execution starts from (OC++ runner): the boundary it delivers input at, how many steps the execution has started, how many steps have run since input was last delivered (the agent's step limit counts these), and when a retried step is due.",
  )
  .scenarios(
    {
      description: 'A Session with no events is idle.',
      given: [],
      when: { sessionID: 'ses_1' },
      expect: next('idle', 0, 0),
    },
    {
      description: 'A started execution begins at an idle boundary.',
      given: [started()],
      when: { sessionID: 'ses_1' },
      expect: next('idle', 0, 0),
    },
    {
      description: 'A step in flight is not a boundary yet.',
      given: [
        started(),
        enqueued('msg_in_1'),
        delivered('msg_in_1'),
        stepStarted('msg_1'),
      ],
      when: { sessionID: 'ses_1' },
      expect: next('step', 1, 1),
    },
    {
      description:
        'A step that needs no follow-up leaves the execution idle: queued input may enter.',
      given: [started(), stepStarted('msg_1'), succeeded('msg_1')],
      when: { sessionID: 'ses_1' },
      expect: next('idle', 1, 1),
    },
    {
      description:
        'A step whose tool results the model must answer continues at a step boundary, and the steps since input keep counting.',
      given: [
        started(),
        enqueued('msg_in_1'),
        delivered('msg_in_1'),
        stepStarted('msg_1'),
        succeeded('msg_1', true),
        stepStarted('msg_2'),
        succeeded('msg_2', true),
      ],
      when: { sessionID: 'ses_1' },
      expect: next('step', 2, 2),
    },
    {
      description: 'Delivered input starts the step count again.',
      given: [
        started(),
        stepStarted('msg_1'),
        succeeded('msg_1', true),
        enqueued('msg_in_1'),
        delivered('msg_in_1'),
      ],
      when: { sessionID: 'ses_1' },
      expect: next('step', 1, 0),
    },
    {
      description: 'A delivered control item does not start the count again.',
      given: [
        started(),
        stepStarted('msg_1'),
        succeeded('msg_1'),
        enqueued('msg_in_1', 'compaction'),
        delivered('msg_in_1'),
      ],
      when: { sessionID: 'ses_1' },
      expect: next('idle', 1, 1),
    },
    {
      description:
        'A retried step is retried at a step boundary when it is due, and keeps its number.',
      given: [started(), stepStarted('msg_1'), retried('msg_1', 5000)],
      when: { sessionID: 'ses_1' },
      expect: next('step', 1, 1, 5000, 2),
    },
    {
      description:
        'The retried attempt is the same step: the count does not move.',
      given: [
        started(),
        stepStarted('msg_1'),
        retried('msg_1'),
        stepStarted('msg_1'),
      ],
      when: { sessionID: 'ses_1' },
      expect: next('step', 2, 1, undefined, 2),
    },
    {
      description:
        "A fresh retry runs as the next step: it keeps the step's number and counts as its next attempt.",
      given: [
        started(),
        stepStarted('msg_1'),
        retried('msg_1', 1000, true),
        stepStarted('msg_2'),
      ],
      when: { sessionID: 'ses_1' },
      expect: next('step', 2, 1, undefined, 2),
    },
    {
      description: 'A new execution starts idle with no steps.',
      given: [
        started(),
        stepStarted('msg_1'),
        succeeded('msg_1', true),
        event('session-execution-settled', {
          sessionID: 'ses_1',
          outcome: 'interrupted',
          reason: 'user',
        }),
        started(),
      ],
      when: { sessionID: 'ses_1' },
      expect: next('idle', 0, 0),
    },
  )

export default nextStepSpec
