import { createQuerySlice, event } from '@specter-ts/spec'

export const runListSpec = createQuerySlice('runList')
  .description('Lists ColonyBench runs.')
  .scenarios({
    description: 'Lists runs in creation order with their latest statuses.',
    given: [
      event('colonybench-run-created', { runId: 'run-1', name: 'First' }),
      event('colonybench-run-started', { runId: 'run-1' }),
      event('colonybench-run-created', { runId: 'run-2', name: 'Second' }),
      event('colonybench-run-completed', { runId: 'run-1' }),
    ],
    when: {},
    expect: [
      { runId: 'run-1', name: 'First', status: 'completed' },
      { runId: 'run-2', name: 'Second', status: 'created' },
    ],
  })

export default runListSpec
