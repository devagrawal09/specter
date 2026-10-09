import { createQuerySlice, event } from '@specter-ts/spec'

// A separate Query rather than a part of session-status-query: a staged
// revert is the UI's concern, and a part there would add it to every status
// scenario's expected output.
const staged = (messageID: string, sessionID = 'ses_1') =>
  event('session-revert-staged', { sessionID, revert: { messageID } })
const cleared = (sessionID = 'ses_1') =>
  event('session-revert-cleared', { sessionID })
const committed = (to: string, sessionID = 'ses_1') =>
  event('session-revert-committed', { sessionID, to })

export const revertStatusSpec = createQuerySlice('revertStatus')
  .description(
    'Reports the staged revert of a Session, or null when none is staged (for the UI).',
  )
  .scenarios(
    {
      description: 'A Session with no revert events has nothing staged.',
      given: [],
      when: { sessionID: 'ses_1' },
      expect: { staged: null },
    },
    {
      description: 'A staged revert is reported with its boundary message.',
      given: [staged('msg_1')],
      when: { sessionID: 'ses_1' },
      expect: { staged: { messageID: 'msg_1' } },
    },
    {
      description: 'Staging again moves the boundary.',
      given: [staged('msg_1'), staged('msg_2')],
      when: { sessionID: 'ses_1' },
      expect: { staged: { messageID: 'msg_2' } },
    },
    {
      description: 'Clearing discards the staged revert.',
      given: [staged('msg_1'), cleared()],
      when: { sessionID: 'ses_1' },
      expect: { staged: null },
    },
    {
      description: 'Committing consumes the staged revert.',
      given: [staged('msg_1'), committed('msg_1')],
      when: { sessionID: 'ses_1' },
      expect: { staged: null },
    },
    {
      description: 'A revert can be staged again after a commit.',
      given: [staged('msg_2'), committed('msg_2'), staged('msg_1')],
      when: { sessionID: 'ses_1' },
      expect: { staged: { messageID: 'msg_1' } },
    },
    {
      description: 'Sessions are independent.',
      given: [staged('msg_1'), staged('msg_5', 'ses_2')],
      when: { sessionID: 'ses_2' },
      expect: { staged: { messageID: 'msg_5' } },
    },
  )

export default revertStatusSpec
