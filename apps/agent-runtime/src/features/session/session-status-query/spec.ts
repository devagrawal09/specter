import { createQuerySlice, event } from '@specter-ts/spec'

// Folded from durable execution, inbox and step events. Per session.md, they
// are a historical record: this answers "what do the events say", and is not
// proof that a process is still live. The step Plugin reads it at the safe
// step boundary, to decide whether a (possibly stale) request still applies
// and what the next step starts from.
type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }
type Part = { readonly [key: string]: JsonValue }

const boom = { type: 'transport', message: 'connection reset' }
const model = { id: 'scripted', providerID: 'test' }
const started = (sessionID = 'ses_1') =>
  event('session-execution-started', { sessionID })
const continued = () =>
  event('session-execution-continued', { sessionID: 'ses_1' })
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
const enqueued = (inboxID: string, type: 'user' | 'compaction' = 'user') =>
  event('session-inbox-enqueued', {
    sessionID: 'ses_1',
    inboxID,
    item:
      type === 'user'
        ? { type: 'user', payload: { text: 'hi' }, delivery: 'steer' }
        : { type: 'compaction', payload: {}, delivery: 'steer' },
  })
const held = (inboxID: string) =>
  event('session-inbox-held', { sessionID: 'ses_1', inboxID })
const delivered = (inboxID: string) =>
  event('session-inbox-delivered', { sessionID: 'ses_1', inboxID })
const cancelled = (inboxID: string) =>
  event('session-inbox-cancelled', { sessionID: 'ses_1', inboxID })
const stepStarted = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-step-started', {
    sessionID,
    assistantMessageID,
    agent: 'build',
    model,
  })
const stepEnded = (assistantMessageID: string, continues = false) =>
  event('session-step-settled', {
    sessionID: 'ses_1',
    assistantMessageID,
    outcome: 'succeeded',
    finish: continues ? 'tool-calls' : 'stop',
    ...(continues ? { continues: true } : {}),
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })
const stepFailed = (assistantMessageID: string) =>
  event('session-step-settled', {
    sessionID: 'ses_1',
    assistantMessageID,
    outcome: 'failed',
    error: boom,
  })
const stepRetried = (assistantMessageID: string, at = 1000, fresh = false) =>
  event('session-step-settled', {
    sessionID: 'ses_1',
    assistantMessageID,
    outcome: 'failed',
    error: boom,
    retry: { attempt: 1, at, ...(fresh ? { fresh: true } : {}) },
  })
const toolCalled = (assistantMessageID: string, id: string, executed = false) =>
  event('session-tool-requested', {
    sessionID: 'ses_1',
    assistantMessageID,
    id,
    name: 'execute',
    input: { code: '1' },
    executed,
  })
const toolSettled = (
  assistantMessageID: string,
  id: string,
  outcome: 'succeeded' | 'failed' = 'succeeded',
) =>
  event(
    'session-tool-settled',
    outcome === 'succeeded'
      ? {
          sessionID: 'ses_1',
          assistantMessageID,
          id,
          outcome,
          content: [{ type: 'text', text: '2' }],
          executed: false,
        }
      : {
          sessionID: 'ses_1',
          assistantMessageID,
          id,
          outcome,
          error: {
            type: 'aborted',
            message: 'Tool execution interrupted: execute',
          },
          executed: false,
        },
  )
const open = (assistantMessageID: string, id: string, executed = false) => ({
  assistantMessageID,
  id,
  name: 'execute',
  executed,
})

// The whole answer, from the parts a scenario is about.
const status = (
  execution: Part = {},
  step: Part = {},
  next: Part = {},
): Part => ({
  status: 'idle',
  executions: 0,
  lastOutcome: null,
  ...execution,
  step: { started: 0, attempts: 0, ...step },
  next: {
    boundary: 'idle',
    stepsInExecution: 0,
    stepsSinceInput: 0,
    attempt: 1,
    ...next,
  },
})
const active = (executions = 1, lastOutcome: string | null = null) => ({
  status: 'active',
  executions,
  lastOutcome,
})
const settled = (lastOutcome: string, more: Part = {}) => ({
  status: 'settled',
  executions: 1,
  lastOutcome,
  ...more,
})
const when = { sessionID: 'ses_1' }

export const sessionStatusSpec = createQuerySlice('sessionStatus')
  .description(
    "Reports a Session's executions (idle, active or settled, with the last outcome and whether pending input will wake it), its steps (the one in flight, its attempts, failure and open calls) and what its next step starts from (session.md: Execution Is Process-Local; One Step May Have Several Physical Attempts).",
  )
  .scenarios(
    // Executions
    {
      description:
        'A Session with no events is idle (no busy period has started).',
      given: [],
      when,
      expect: status(),
    },
    {
      description:
        'A started, unended execution is a busy period currently owned: active, at an idle boundary.',
      given: [started()],
      when,
      expect: status(active()),
    },
    {
      description: 'Success ends the busy period: the Session is settled.',
      given: [started(), succeeded()],
      when,
      expect: status(settled('succeeded')),
    },
    {
      description:
        'Failure ends the busy period: the Session is settled, with the error that failed it.',
      given: [started(), failed()],
      when,
      expect: status(
        settled('failed', { error: { type: 'provider', message: 'boom' } }),
      ),
    },
    {
      description:
        'Interruption ends the busy period: the Session is settled with outcome interrupted and its reason.',
      given: [started(), interrupted()],
      when,
      expect: status(settled('interrupted', { reason: 'user' })),
    },
    {
      description:
        'A new busy period after a settled one makes the Session active again.',
      given: [started(), succeeded(), started()],
      when,
      expect: status(active(2, 'succeeded')),
    },
    {
      description:
        'Different Sessions run concurrently: status is per Session, so an active ses_2 leaves ses_1 idle.',
      given: [started('ses_2'), stepStarted('msg_1', 'ses_2')],
      when,
      expect: status(),
    },
    // Wakes
    {
      description:
        'Input that will wake the Session keeps it from idle: the next execution starts from it.',
      given: [started(), enqueued('msg_1'), failed()],
      when,
      expect: status(
        settled('failed', {
          error: { type: 'provider', message: 'boom' },
          wakes: true,
        }),
      ),
    },
    {
      description:
        'An execution takes the wakes recorded before it started: input it never delivered before failing waits for the next wake, and the Session is idle.',
      given: [enqueued('msg_1'), started(), failed()],
      when,
      expect: status(
        settled('failed', { error: { type: 'provider', message: 'boom' } }),
      ),
    },
    {
      description:
        'Held, delivered or cancelled input wakes nothing, and an interruption parks what is pending.',
      given: [
        enqueued('msg_1'),
        held('msg_1'),
        enqueued('msg_2'),
        delivered('msg_2'),
        enqueued('msg_3'),
        cancelled('msg_3'),
        started(),
        enqueued('msg_4'),
        interrupted(),
      ],
      when,
      expect: status(settled('interrupted', { reason: 'user' })),
    },
    // Steps
    {
      description: 'A started, unended step is in flight: not a boundary yet.',
      given: [
        started(),
        enqueued('msg_in'),
        delivered('msg_in'),
        stepStarted('msg_1'),
      ],
      when,
      expect: status(
        active(),
        { inFlight: 'msg_1', started: 1, attempts: 1 },
        { boundary: 'step', stepsInExecution: 1, stepsSinceInput: 1 },
      ),
    },
    {
      description:
        'A step that needs no follow-up is no longer in flight and leaves the execution idle: queued input may enter.',
      given: [started(), stepStarted('msg_1'), stepEnded('msg_1')],
      when,
      expect: status(
        active(),
        { started: 1, attempts: 1 },
        { stepsInExecution: 1, stepsSinceInput: 1 },
      ),
    },
    {
      description:
        'A step whose tool results the model must answer continues at a step boundary, and the steps since input keep counting.',
      given: [
        started(),
        enqueued('msg_in'),
        delivered('msg_in'),
        stepStarted('msg_1'),
        stepEnded('msg_1', true),
        stepStarted('msg_2'),
        stepEnded('msg_2', true),
      ],
      when,
      expect: status(
        active(),
        { started: 2, attempts: 1 },
        { boundary: 'step', stepsInExecution: 2, stepsSinceInput: 2 },
      ),
    },
    {
      description: 'Delivered input starts the step-limit count again.',
      given: [
        started(),
        stepStarted('msg_1'),
        stepEnded('msg_1', true),
        enqueued('msg_in'),
        delivered('msg_in'),
      ],
      when,
      expect: status(
        active(),
        { started: 1, attempts: 1 },
        { boundary: 'step', stepsInExecution: 1, stepsSinceInput: 0 },
      ),
    },
    {
      description: 'A delivered control item does not start the count again.',
      given: [
        started(),
        stepStarted('msg_1'),
        stepEnded('msg_1'),
        enqueued('msg_in', 'compaction'),
        delivered('msg_in'),
      ],
      when,
      expect: status(
        active(),
        { started: 1, attempts: 1 },
        { stepsInExecution: 1, stepsSinceInput: 1 },
      ),
    },
    {
      description:
        'The step count spans executions of one Session; a new execution starts idle with no steps of its own.',
      given: [
        started(),
        stepStarted('msg_1'),
        stepEnded('msg_1', true),
        interrupted(),
        started(),
      ],
      when,
      // The last outcome keeps its reason while the next execution runs.
      expect: status(
        { ...active(2, 'interrupted'), reason: 'user' },
        { started: 1, attempts: 1 },
      ),
    },
    {
      description:
        'An execution continuing an interrupted turn rests at entry boundaries: never queued input.',
      given: [started(), continued()],
      when,
      expect: status(active(), {}, { boundary: 'entry' }),
    },
    {
      description: 'Interruption clears the step in flight; the counts stay.',
      given: [started(), stepStarted('msg_1'), interrupted()],
      when,
      expect: status(
        settled('interrupted', { reason: 'user' }),
        { started: 1, attempts: 1 },
        { boundary: 'step', stepsInExecution: 1, stepsSinceInput: 1 },
      ),
    },
    // Attempts and failures
    {
      description:
        'A failed attempt is no longer in flight and exposes its failure; the attempt still counts.',
      given: [started(), stepStarted('msg_1'), stepFailed('msg_1')],
      when,
      expect: status(
        active(),
        { started: 1, attempts: 1, lastFailure: boom },
        { boundary: 'step', stepsInExecution: 1, stepsSinceInput: 1 },
      ),
    },
    {
      description:
        'A retried step is retried at a step boundary when it is due, keeps its number, and keeps the failure visible until the next attempt starts.',
      given: [started(), stepStarted('msg_1'), stepRetried('msg_1', 5000)],
      when,
      expect: status(
        active(),
        { started: 1, attempts: 1, retrying: true, lastFailure: boom },
        {
          boundary: 'step',
          stepsInExecution: 1,
          stepsSinceInput: 1,
          retryAt: 5000,
          attempt: 2,
        },
      ),
    },
    {
      description:
        'The retried attempt is the same step with a second physical attempt: the step counts do not grow and the failure clears.',
      given: [
        started(),
        stepStarted('msg_1'),
        stepRetried('msg_1'),
        stepStarted('msg_1'),
      ],
      when,
      expect: status(
        active(),
        { inFlight: 'msg_1', started: 1, attempts: 2 },
        {
          boundary: 'step',
          stepsInExecution: 2,
          stepsSinceInput: 1,
          attempt: 2,
        },
      ),
    },
    {
      description:
        "A fresh retry runs as the next step: it keeps the step's number and counts as its next attempt.",
      given: [
        started(),
        stepStarted('msg_1'),
        stepRetried('msg_1', 1000, true),
        stepStarted('msg_2'),
      ],
      when,
      expect: status(
        active(),
        { inFlight: 'msg_2', started: 2, attempts: 1 },
        {
          boundary: 'step',
          stepsInExecution: 2,
          stepsSinceInput: 1,
          attempt: 2,
        },
      ),
    },
    {
      description:
        'A retried step that then ends reports every attempt it took; the next step counts its attempts from one.',
      given: [
        started(),
        stepStarted('msg_1'),
        stepRetried('msg_1'),
        stepStarted('msg_1'),
        stepEnded('msg_1', true),
        stepStarted('msg_2'),
      ],
      when,
      expect: status(
        active(),
        { inFlight: 'msg_2', started: 2, attempts: 1 },
        { boundary: 'step', stepsInExecution: 3, stepsSinceInput: 2 },
      ),
    },
    {
      description:
        'A terminal execution event clears the failure; the counts stay.',
      given: [
        started(),
        stepStarted('msg_1'),
        stepFailed('msg_1'),
        event('session-execution-settled', {
          sessionID: 'ses_1',
          outcome: 'failed',
          error: boom,
        }),
      ],
      when,
      expect: status(
        settled('failed', { error: boom }),
        { started: 1, attempts: 1 },
        { boundary: 'step', stepsInExecution: 1, stepsSinceInput: 1 },
      ),
    },
    // Open calls
    {
      description:
        'Open calls keep call order, with their names and executed flags, and a settled one (success or failure) leaves the list.',
      given: [
        started(),
        stepStarted('msg_1'),
        toolCalled('msg_1', 'call_1'),
        toolCalled('msg_1', 'call_2', true),
        toolCalled('msg_1', 'call_3'),
        toolSettled('msg_1', 'call_1'),
        toolSettled('msg_1', 'call_3', 'failed'),
      ],
      when,
      expect: status(
        active(),
        {
          inFlight: 'msg_1',
          started: 1,
          attempts: 1,
          openCalls: [open('msg_1', 'call_2', true)],
        },
        { boundary: 'step', stepsInExecution: 1, stepsSinceInput: 1 },
      ),
    },
    {
      description: 'When every call is settled the field is omitted.',
      given: [
        started(),
        stepStarted('msg_1'),
        toolCalled('msg_1', 'call_1'),
        toolSettled('msg_1', 'call_1', 'failed'),
      ],
      when,
      expect: status(
        active(),
        { inFlight: 'msg_1', started: 1, attempts: 1 },
        { boundary: 'step', stepsInExecution: 1, stepsSinceInput: 1 },
      ),
    },
    {
      description:
        'A new attempt of the same step starts with a clean call table: calls the failed attempt left open are not reported.',
      given: [
        started(),
        stepStarted('msg_1'),
        toolCalled('msg_1', 'call_1'),
        stepRetried('msg_1'),
        stepStarted('msg_1'),
      ],
      when,
      expect: status(
        active(),
        { inFlight: 'msg_1', started: 1, attempts: 2 },
        {
          boundary: 'step',
          stepsInExecution: 2,
          stepsSinceInput: 1,
          attempt: 2,
        },
      ),
    },
    {
      description:
        'A terminal execution event drops open calls: an interrupted execution has nothing left to settle.',
      given: [
        started(),
        stepStarted('msg_1'),
        toolCalled('msg_1', 'call_1'),
        interrupted(),
      ],
      when,
      expect: status(
        settled('interrupted', { reason: 'user' }),
        { started: 1, attempts: 1 },
        { boundary: 'step', stepsInExecution: 1, stepsSinceInput: 1 },
      ),
    },
  )

export default sessionStatusSpec
