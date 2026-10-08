import { createReactionSlice, event } from '@specter-ts/spec'

// The inbox item schema (@ocpp/schema session-inbox) has no `resume` field:
// `resume` only decides whether enqueue-input's caller wakes. The enqueued
// event therefore cannot distinguish resume:false, so the "false records the
// input without scheduling execution" sentence is not expressible here.
const enqueued = (sessionID: string, inboxID: string) =>
  event('session-inbox-enqueued', {
    sessionID,
    inboxID,
    item: { type: 'user', payload: { text: 'hello' }, delivery: 'steer' },
  })
const started = (sessionID: string) =>
  event('session-execution-started', { sessionID })
const succeeded = (sessionID: string) =>
  event('session-execution-succeeded', { sessionID })
const failed = (sessionID: string) =>
  event('session-execution-failed', {
    sessionID,
    error: { type: 'provider', message: 'boom' },
  })
const interrupted = (sessionID: string) =>
  event('session-execution-interrupted', { sessionID, reason: 'user' })
const start = (sessionID: string) => ({
  type: 'startExecution',
  payload: { sessionID },
})

export const wakeExecutionSpec = createReactionSlice('wakeExecution')
  .description(
    'Schedules execution after input is recorded: requests startExecution on session.inbox.enqueued unless the Session is already active (session.md: Execution Is Process-Local).',
  )
  .scenarios(
    {
      description:
        'Omitted or true records the input, then schedules SessionExecution.wake: an enqueue on an idle Session requests a start.',
      given: [enqueued('ses_1', 'msg_1')],
      expect: [start('ses_1')],
    },
    {
      description:
        'Explicit resumes join the active execution, and repeated wakes coalesce: an enqueue while active requests nothing.',
      given: [started('ses_1'), enqueued('ses_1', 'msg_1')],
      expect: [],
    },
    {
      description:
        'Repeated wakes coalesce into one follow-up drain: a second enqueue while still active requests nothing.',
      given: [
        enqueued('ses_1', 'msg_1'),
        started('ses_1'),
        enqueued('ses_1', 'msg_2'),
      ],
      expect: [],
    },
    {
      description:
        'After success releases the claim, the next enqueue wakes the Session again.',
      given: [started('ses_1'), succeeded('ses_1'), enqueued('ses_1', 'msg_2')],
      expect: [start('ses_1')],
    },
    {
      description:
        'After failure releases the claim, the next enqueue wakes the Session again.',
      given: [started('ses_1'), failed('ses_1'), enqueued('ses_1', 'msg_2')],
      expect: [start('ses_1')],
    },
    {
      description:
        'After interruption, the next enqueue wakes the Session again.',
      given: [
        started('ses_1'),
        interrupted('ses_1'),
        enqueued('ses_1', 'msg_2'),
      ],
      expect: [start('ses_1')],
    },
    {
      description:
        'Different Sessions run concurrently: an active execution in ses_1 does not suppress the wake for ses_2.',
      given: [started('ses_1'), enqueued('ses_2', 'msg_1')],
      expect: [start('ses_2')],
    },
    {
      description:
        'Different Sessions are independent: an active execution in ses_2 does not suppress the wake for ses_1, and the ses_2 enqueue requests nothing.',
      given: [started('ses_2'), enqueued('ses_2', 'msg_1')],
      expect: [],
    },
    {
      description:
        'Only enqueue schedules a wake: an interruption alone requests nothing, so interruption never restarts pending input by itself.',
      given: [
        enqueued('ses_1', 'msg_1'),
        started('ses_1'),
        interrupted('ses_1'),
      ],
      expect: [],
    },
  )

export default wakeExecutionSpec
