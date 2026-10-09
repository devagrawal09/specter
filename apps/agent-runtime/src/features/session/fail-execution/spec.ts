import { createCommandSlice, event } from '@specter-ts/spec'

const started = () => event('session-execution-started', { sessionID: 'ses_1' })
const error = {
  type: 'compaction.failed',
  message: 'Compaction produced no summary',
}

export const failExecutionSpec = createCommandSlice('failExecution')
  .description(
    'Fails the active execution of a Session for a reason outside a step, such as a compaction that failed (OC++ runner: a failed compaction fails the drain).',
  )
  .scenarios(
    {
      description: 'An active execution fails with the error.',
      given: [started()],
      when: { sessionID: 'ses_1', error },
      expect: [
        event('session-execution-settled', {
          sessionID: 'ses_1',
          outcome: 'failed',
          error,
        }),
      ],
    },
    {
      description: 'An idle Session has no execution to fail.',
      given: [],
      when: { sessionID: 'ses_1', error },
      expect: [],
      reject: { reason: 'Execution not active' },
    },
    {
      description: 'A settled execution cannot fail again.',
      given: [
        started(),
        event('session-execution-settled', {
          sessionID: 'ses_1',
          outcome: 'interrupted',
          reason: 'user',
        }),
      ],
      when: { sessionID: 'ses_1', error },
      expect: [],
      reject: { reason: 'Execution not active' },
    },
  )

export default failExecutionSpec
