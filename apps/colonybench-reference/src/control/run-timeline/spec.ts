import { createQuerySlice, event } from '@specter-ts/core/spec'

const frame = {
  runId: 'run-1',
  tick: 1,
  score: 0,
  workerCount: 1,
  baseLevel: 1,
  baseEnergy: 0,
  commandCount: 2,
  eventTypes: ['colonybench-tick-advanced'],
}

export const runTimelineSpec = createQuerySlice('runTimeline')
  .description('Returns compact live timeline frames for a ColonyBench run.')
  .scenarios({
    description: 'Returns recorded frames in append order.',
    given: [
      event('colonybench-run-created', { runId: 'run-1', name: 'Run' }),
      event('colonybench-run-frame-recorded', frame),
    ],
    when: { runId: 'run-1' },
    expect: [frame],
  })
