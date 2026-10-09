import { createReactionSlice, event } from '@specter-ts/spec'

// A Session whose model selects an external agent (OC++'s SessionDriver) runs
// its executions in that agent: the runtime starts, settles and interrupts
// them, and the host drives each one whole. One request per execution: it
// carries the execution's number, so a duplicate is recognisably stale. What
// the Plugin does with it is covered by session.integration.test.ts.
const vendor = { id: 'sonnet', providerID: 'claude' }
const created = (sessionID: string, model?: typeof vendor) =>
  event('session-created', {
    sessionID,
    projectID: 'prj_1',
    location: { directory: '/tmp/ws' },
    slug: `slug-${sessionID}`,
    version: '2',
    ...(model ? { model } : {}),
  })
const selected = (
  sessionID: string,
  model: { id: string; providerID: string },
) => event('session-model-selected', { sessionID, model })
const started = (sessionID: string) =>
  event('session-execution-started', { sessionID })
const succeeded = (sessionID: string) =>
  event('session-execution-settled', { sessionID, outcome: 'succeeded' })
const drive = (sessionID: string, execution: number) => ({
  type: 'driveExecution',
  payload: { sessionID, execution },
})

export const driveExecutionSpec = createReactionSlice('driveExecution')
  .description(
    'Requests that the host drive an execution of a Session an external agent runs, once per execution.',
  )
  .scenarios(
    {
      description:
        'An execution of a Session whose model selects an external agent is driven by the host.',
      given: [created('ses_1', vendor), started('ses_1')],
      expect: [drive('ses_1', 1)],
    },
    {
      description:
        "A Session this runtime runs takes its steps from the step Reaction, not from the host's agent.",
      given: [created('ses_1'), started('ses_1')],
      expect: [],
    },
    {
      description: 'Each execution is its own request, numbered from 1.',
      given: [
        created('ses_1', vendor),
        started('ses_1'),
        succeeded('ses_1'),
        started('ses_1'),
      ],
      expect: [drive('ses_1', 2)],
    },
    {
      description: 'A settled execution needs no driving.',
      given: [created('ses_1', vendor), started('ses_1'), succeeded('ses_1')],
      expect: [],
    },
    {
      description:
        'The driver is read when the execution starts: selecting a vendor model makes the next execution driven.',
      given: [created('ses_1'), selected('ses_1', vendor), started('ses_1')],
      expect: [drive('ses_1', 1)],
    },
    {
      description:
        'Different Sessions are independent: the Session whose execution started last is the one requested.',
      given: [
        created('ses_1', vendor),
        created('ses_2', vendor),
        started('ses_2'),
        started('ses_1'),
      ],
      expect: [drive('ses_1', 1)],
    },
  )

export default driveExecutionSpec
