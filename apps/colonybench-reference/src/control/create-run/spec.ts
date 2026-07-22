import { createCommandSlice, event } from '@specter-ts/spec'

export const createRunSpec = createCommandSlice('createRun')
  .description('Creates a ColonyBench run.')
  .scenarios({
    description: 'Creates a named run with the supplied deterministic ID.',
    given: [],
    when: { runId: 'run-1', name: 'Baseline run' },
    expect: [
      event('colonybench-run-created', {
        runId: 'run-1',
        name: 'Baseline run',
      }),
    ],
  })

export default createRunSpec
