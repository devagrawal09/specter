import { createQuerySlice, event } from '@specter-ts/spec'

const frame = {
  runId: 'run-1',
  tick: 1,
  score: 100,
  workerCount: 2,
  baseLevel: 2,
  baseEnergy: 5,
  commandCount: 3,
  eventTypes: ['colonybench-tick-advanced'],
}

export const runOverviewSpec = createQuerySlice('runOverview')
  .description(
    'Returns a UI-friendly ColonyBench run summary with the latest frame.',
  )
  .scenarios({
    description: 'Returns the completed run and its latest frame.',
    given: [
      event('colonybench-run-created', { runId: 'run-1', name: 'Run' }),
      event('colonybench-run-started', { runId: 'run-1' }),
      event('colonybench-run-frame-recorded', frame),
      event('colonybench-run-completed', { runId: 'run-1' }),
    ],
    when: { runId: 'run-1' },
    expect: {
      run: { runId: 'run-1', name: 'Run', status: 'completed' },
      frameCount: 1,
      latestFrame: frame,
    },
  })

export default runOverviewSpec
