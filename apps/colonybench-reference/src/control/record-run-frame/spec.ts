import { createCommandSlice, event } from '@specter-ts/core/spec'

const frame = {
  runId: 'run-1',
  tick: 2,
  score: 100,
  workerCount: 2,
  baseLevel: 2,
  baseEnergy: 5,
  commandCount: 3,
  eventTypes: ['colonybench-tick-advanced'],
}

export const recordRunFrameSpec = createCommandSlice('recordRunFrame')
  .description('Records a compact live timeline frame for a ColonyBench run.')
  .scenarios(
    {
      description: 'Records an exact frame for an existing run.',
      given: [
        event('colonybench-run-created', { runId: 'run-1', name: 'Run' }),
      ],
      when: frame,
      expect: [event('colonybench-run-frame-recorded', frame)],
    },
    {
      description: 'Rejects a frame for an unknown run.',
      given: [],
      when: { ...frame, runId: 'missing-run' },
      expect: [],
      reject: { reason: 'Run not found: missing-run' },
    },
  )
