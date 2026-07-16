import { createCommandSlice, event } from '@specter-ts/core/spec'

export const initializeSimulationSpec = createCommandSlice(
  'initializeSimulation',
)
  .description('Initializes an in-memory ColonyBench simulation world.')
  .scenarios({
    description: 'Initializes the world for the supplied run.',
    given: [],
    when: { runId: 'run-1' },
    expect: [event('colonybench-simulation-initialized', { runId: 'run-1' })],
  })
