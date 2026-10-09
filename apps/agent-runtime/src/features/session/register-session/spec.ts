import { createCommandSlice, event } from '@specter-ts/spec'

// The host (OC++) owns Session creation. When the runtime is embedded, the
// host registers a Session it created before the first runtime Command for it,
// with the same payload it published. The runtime only learns that the Session
// exists; it never creates one.
const created = (sessionID = 'ses_1', extra: Record<string, string> = {}) =>
  event('session-created', {
    sessionID,
    projectID: 'prj_1',
    location: { directory: '/tmp/ws' },
    slug: 'brave-otter',
    version: '2',
    ...extra,
  })
const registration = (
  sessionID = 'ses_1',
  extra: Record<string, string> = {},
) => ({
  sessionID,
  projectID: 'prj_1',
  location: { directory: '/tmp/ws' },
  slug: 'brave-otter',
  version: '2',
  ...extra,
})

export const registerSessionSpec = createCommandSlice('registerSession')
  .description(
    'Records a Session the embedding host created, so runtime Commands can address it.',
  )
  .scenarios(
    {
      description:
        "An unknown Session is registered with the host's session.created payload.",
      given: [],
      when: registration(),
      expect: [created()],
    },
    {
      description:
        'A child Session keeps its parent: the payload is recorded as the host published it.',
      given: [created()],
      when: registration('ses_2', { parentID: 'ses_1', title: 'Child' }),
      expect: [created('ses_2', { parentID: 'ses_1', title: 'Child' })],
    },
    {
      description:
        'Registering a Session twice is rejected; the first registration stands.',
      given: [created()],
      when: registration(),
      expect: [],
      reject: { reason: 'Session already registered' },
    },
  )

export default registerSessionSpec
