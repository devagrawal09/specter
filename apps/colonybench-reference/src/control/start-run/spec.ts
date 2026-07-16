import { createCommandSlice, event } from '@specter-ts/core/spec'

const created = event('colonybench-run-created', {
  runId: 'run-1',
  name: 'Baseline run',
})

export const startRunSpec = createCommandSlice('startRun')
  .description('Starts a ColonyBench run.')
  .scenarios(
    {
      description: 'Starts a created run.',
      given: [created],
      when: { runId: 'run-1' },
      expect: [event('colonybench-run-started', { runId: 'run-1' })],
    },
    {
      description: 'Rejects a run that is already started.',
      given: [created, event('colonybench-run-started', { runId: 'run-1' })],
      when: { runId: 'run-1' },
      expect: [],
      reject: { reason: 'Run already started: run-1' },
    },
    {
      description: 'Rejects a completed run.',
      given: [created, event('colonybench-run-completed', { runId: 'run-1' })],
      when: { runId: 'run-1' },
      expect: [],
      reject: { reason: 'Run already completed: run-1' },
    },
    {
      description: 'Rejects an unknown run.',
      given: [],
      when: { runId: 'missing-run' },
      expect: [],
      reject: { reason: 'Run not found: missing-run' },
    },
  )
