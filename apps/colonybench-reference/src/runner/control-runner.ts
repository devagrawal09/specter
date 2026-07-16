import type { ColonyBenchRunFrameSummary } from '../control/state'
import type { ColonyBenchControlApp } from '../index'
import {
  streamColonyBenchLoop,
  type ColonyBenchRunFrame,
  type RunColonyBenchLoopOptions,
  type RunColonyBenchLoopResult,
} from './run-loop'
import type { ColonyBenchBotMemory } from './types'

export type RunColonyBenchRecordedLoopOptions<
  TMemory extends object = ColonyBenchBotMemory,
> = RunColonyBenchLoopOptions<TMemory> & {
  controlApp: ColonyBenchControlApp
  name?: string
}

export function summarizeColonyBenchRunFrame(
  frame: ColonyBenchRunFrame,
): ColonyBenchRunFrameSummary {
  return {
    runId: frame.runId,
    tick: frame.tick,
    score: frame.snapshot.score,
    workerCount: frame.snapshot.workers.length,
    baseLevel: frame.snapshot.base?.level ?? 0,
    baseEnergy: frame.snapshot.base?.energy ?? 0,
    commandCount: frame.commands.length,
    eventTypes: frame.events.map((event) => event.type),
  }
}

async function commandAndWait(
  app: ColonyBenchControlApp,
  envelope: Parameters<ColonyBenchControlApp['command']>[0],
) {
  const execution = await app.command(envelope)
  await execution.reactions
}

export async function runColonyBenchRecordedLoop<
  TMemory extends object = ColonyBenchBotMemory,
>({
  controlApp,
  name,
  ...loopOptions
}: RunColonyBenchRecordedLoopOptions<TMemory>): Promise<
  RunColonyBenchLoopResult<TMemory>
> {
  await commandAndWait(controlApp, {
    type: 'createRun',
    payload: {
      runId: loopOptions.runId,
      name: name ?? loopOptions.runId,
    },
  })
  await commandAndWait(controlApp, {
    type: 'startRun',
    payload: { runId: loopOptions.runId },
  })

  const iterator = streamColonyBenchLoop(loopOptions)[Symbol.asyncIterator]()

  while (true) {
    const next = await iterator.next()
    if (next.done) {
      await commandAndWait(controlApp, {
        type: 'completeRun',
        payload: { runId: loopOptions.runId },
      })
      return next.value
    }

    await commandAndWait(controlApp, {
      type: 'recordRunFrame',
      payload: summarizeColonyBenchRunFrame(next.value),
    })
  }
}
