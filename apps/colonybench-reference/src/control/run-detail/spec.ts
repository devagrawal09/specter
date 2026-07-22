import { createQuerySlice, event } from '@specter-ts/spec'

export const runDetailSpec = createQuerySlice('runDetail')
  .description('Returns one ColonyBench run.')
  .scenarios(
    {
      description: 'Returns null for an unknown run.',
      given: [],
      when: { runId: 'missing-run' },
      expect: null,
    },
    {
      description: 'Returns the latest status of a completed run.',
      given: [
        event('colonybench-run-created', { runId: 'run-1', name: 'Run' }),
        event('colonybench-run-started', { runId: 'run-1' }),
        event('colonybench-run-completed', { runId: 'run-1' }),
      ],
      when: { runId: 'run-1' },
      expect: { runId: 'run-1', name: 'Run', status: 'completed' },
    },
  )

export default runDetailSpec
