import { createCommandSlice, event } from '@specter-ts/spec'

const created = event('colonybench-run-created', {
  runId: 'run-1',
  name: 'Baseline run',
})

export const completeRunSpec = createCommandSlice('completeRun')
  .description('Marks a ColonyBench run as completed.')
  .scenarios(
    {
      description: 'Completes a started run.',
      given: [created, event('colonybench-run-started', { runId: 'run-1' })],
      when: { runId: 'run-1' },
      expect: [event('colonybench-run-completed', { runId: 'run-1' })],
    },
    {
      description: 'Rejects a run that has not started.',
      given: [created],
      when: { runId: 'run-1' },
      expect: [],
      reject: { reason: 'Run not started: run-1' },
    },
    {
      description: 'Rejects a run that is already completed.',
      given: [
        created,
        event('colonybench-run-started', { runId: 'run-1' }),
        event('colonybench-run-completed', { runId: 'run-1' }),
      ],
      when: { runId: 'run-1' },
      expect: [],
      reject: { reason: 'Run not started: run-1' },
    },
    {
      description: 'Rejects an unknown run.',
      given: [],
      when: { runId: 'missing-run' },
      expect: [],
      reject: { reason: 'Run not found: missing-run' },
    },
  )

export default completeRunSpec
