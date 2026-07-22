import { createQuerySlice, event } from '@specter-ts/spec'

export const liveSimulationStatusSpec = createQuerySlice('liveSimulationStatus')
  .description('Returns the live in-memory simulation status for a run.')
  .scenarios(
    {
      description: 'Reports a missing world before initialization.',
      given: [],
      when: { runId: 'run-1' },
      expect: { runId: 'run-1', initialized: false, status: 'missing' },
    },
    {
      description: 'Reports an initialized world.',
      given: [event('colonybench-simulation-initialized', { runId: 'run-1' })],
      when: { runId: 'run-1' },
      expect: { runId: 'run-1', initialized: true, status: 'initialized' },
    },
  )

export default liveSimulationStatusSpec
