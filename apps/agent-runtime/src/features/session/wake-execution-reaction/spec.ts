import { createReactionSlice, event } from '@specter-ts/spec'

const enqueued = (sessionID: string, inboxID: string) =>
  event('session-inbox-enqueued', {
    sessionID,
    inboxID,
    item: { type: 'user', payload: { text: 'hello' }, delivery: 'steer' },
  })
// Admitted with `resume: false`: recorded in the enqueue's commit.
const held = (sessionID: string, inboxID: string) =>
  event('session-inbox-held', { sessionID, inboxID })
const started = (sessionID: string) =>
  event('session-execution-started', { sessionID })
const succeeded = (sessionID: string) =>
  event('session-execution-settled', { sessionID, outcome: 'succeeded' })
const failed = (sessionID: string) =>
  event('session-execution-settled', {
    sessionID,
    outcome: 'failed',
    error: { type: 'provider', message: 'boom' },
  })
const interrupted = (sessionID: string) =>
  event('session-execution-settled', {
    sessionID,
    outcome: 'interrupted',
    reason: 'user',
  })
const start = (sessionID: string) => ({
  type: 'startExecution',
  payload: { sessionID },
})

export const wakeExecutionSpec = createReactionSlice('wakeExecution')
  .description(
    'Schedules execution after input is recorded: requests startExecution on session.inbox.enqueued unless the input is held or the Session is already active (session.md: Execution Is Process-Local).',
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
        'A Session whose model selects an external agent is driven by that agent, not this runtime: its input requests nothing.',
      given: [
        event('session-created', {
          sessionID: 'ses_1',
          projectID: 'prj_1',
          location: { directory: '/tmp/ws' },
          slug: 'brave-otter',
          version: '2',
          model: { id: 'sonnet', providerID: 'claude' },
        }),
        enqueued('ses_1', 'msg_1'),
      ],
      expect: [],
    },
    {
      description:
        'Selecting an OC++ model hands the Session back to this runtime: its pending input requests a start.',
      given: [
        event('session-model-selected', {
          sessionID: 'ses_1',
          model: { id: 'sonnet', providerID: 'claude' },
        }),
        enqueued('ses_1', 'msg_1'),
        event('session-model-selected', {
          sessionID: 'ses_1',
          model: { id: 'gpt-5', providerID: 'openai' },
        }),
      ],
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
    {
      description:
        'A held input waits for the next wake: on an idle Session it requests nothing.',
      given: [enqueued('ses_1', 'msg_1'), held('ses_1', 'msg_1')],
      expect: [],
    },
    {
      description:
        'A held input does not undo an interruption: the input pending before it still does not wake the Session.',
      given: [
        enqueued('ses_1', 'msg_1'),
        started('ses_1'),
        interrupted('ses_1'),
        enqueued('ses_1', 'msg_2'),
        held('ses_1', 'msg_2'),
      ],
      expect: [],
    },
    {
      description:
        'A waking input after a held one requests a start; the execution delivers both.',
      given: [
        enqueued('ses_1', 'msg_1'),
        held('ses_1', 'msg_1'),
        enqueued('ses_1', 'msg_2'),
      ],
      expect: [start('ses_1')],
    },
    {
      description:
        'Different Sessions run concurrently: two Sessions that enqueue before either starts both need a wake; the lowest Session ID is requested first (one output per commit).',
      given: [enqueued('ses_2', 'msg_1'), enqueued('ses_1', 'msg_1')],
      expect: [start('ses_1')],
    },
    {
      description:
        'The second Session is woken on the following commit: once ses_1 starts, the re-run requests ses_2.',
      given: [
        enqueued('ses_2', 'msg_1'),
        enqueued('ses_1', 'msg_1'),
        started('ses_1'),
      ],
      expect: [start('ses_2')],
    },
    {
      description:
        'Both Sessions started: nothing is left to wake after the follow-up commit.',
      given: [
        enqueued('ses_1', 'msg_1'),
        enqueued('ses_2', 'msg_1'),
        started('ses_1'),
        started('ses_2'),
      ],
      expect: [],
    },
    {
      description:
        'An inbox item cancelled before any wake is no longer pending input: nothing to wake.',
      given: [
        enqueued('ses_1', 'msg_1'),
        event('session-inbox-cancelled', {
          sessionID: 'ses_1',
          inboxID: 'msg_1',
        }),
      ],
      expect: [],
    },
    {
      description:
        'A delivered item is consumed from the inbox: once the execution settles, the Session has no pending input and is not woken again.',
      given: [
        enqueued('ses_1', 'msg_1'),
        event('session-inbox-delivered', {
          sessionID: 'ses_1',
          inboxID: 'msg_1',
        }),
        started('ses_1'),
        succeeded('ses_1'),
      ],
      expect: [],
    },
    {
      description:
        'Repeated wakes coalesce into one follow-up drain: input enqueued during an execution is still pending when it settles, so exactly one follow-up start is requested.',
      given: [
        enqueued('ses_1', 'msg_1'),
        started('ses_1'),
        enqueued('ses_1', 'msg_2'),
        succeeded('ses_1'),
      ],
      expect: [start('ses_1')],
    },
  )

export default wakeExecutionSpec
