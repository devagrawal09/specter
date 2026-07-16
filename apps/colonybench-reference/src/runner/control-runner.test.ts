import { describe, expect, test } from 'vitest'

import { baselineBot } from '../bots/baseline'
import {
  createColonyBenchControlApp,
  createMemoryColonyBenchControlAdapters,
} from '../index'
import type { ColonyBenchRunOverview } from '../control/state'
import { runColonyBenchRecordedLoop } from './control-runner'

async function nextOverviewUntil(
  iterator: AsyncIterator<ColonyBenchRunOverview>,
  predicate: (overview: ColonyBenchRunOverview) => boolean,
) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const next = await iterator.next()
    if (next.done) throw new Error('overview subscription closed early')
    if (predicate(next.value)) return next.value
  }

  throw new Error('overview subscription did not reach expected state')
}

describe('ColonyBench recorded control runner', () => {
  test('records streamed runner frames into control timeline and completes the run for live UI queries', async () => {
    const controlApp = await createColonyBenchControlApp({
      adapters: createMemoryColonyBenchControlAdapters(),
    })
    const overview = controlApp.subscribe
      .runOverview({
        runId: 'recorded-baseline',
      })
      [Symbol.asyncIterator]()

    await expect(overview.next()).resolves.toEqual({
      done: false,
      value: { run: null, frameCount: 0, latestFrame: null },
    })

    const completedOverviewPromise = nextOverviewUntil(
      overview,
      (value) => value.run?.status === 'completed',
    )

    const result = await runColonyBenchRecordedLoop({
      controlApp,
      runId: 'recorded-baseline',
      name: 'Recorded baseline',
      ticks: 2,
      bot: baselineBot,
    })
    const completedOverview = await completedOverviewPromise

    expect(result.finalSnapshot.tick).toBe(2)
    expect(completedOverview).toEqual({
      run: {
        runId: 'recorded-baseline',
        name: 'Recorded baseline',
        status: 'completed',
      },
      frameCount: 3,
      latestFrame: {
        runId: 'recorded-baseline',
        tick: 2,
        score: result.finalSnapshot.score,
        workerCount: result.finalSnapshot.workers.length,
        baseLevel: result.finalSnapshot.base?.level ?? 0,
        baseEnergy: result.finalSnapshot.base?.energy ?? 0,
        commandCount: result.commandLog[1]?.commands.length ?? 0,
        eventTypes: expect.arrayContaining(['colonybench-tick-advanced']),
      },
    })
    await expect(
      controlApp.runTimeline({ runId: 'recorded-baseline' }),
    ).resolves.toEqual([
      expect.objectContaining({
        runId: 'recorded-baseline',
        tick: 0,
        commandCount: 0,
        eventTypes: ['colonybench-simulation-initialized'],
      }),
      expect.objectContaining({
        runId: 'recorded-baseline',
        tick: 1,
      }),
      expect.objectContaining({
        runId: 'recorded-baseline',
        tick: 2,
      }),
    ])

    await overview.return?.()
  })
})
