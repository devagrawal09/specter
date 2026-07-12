import {
  createCommandSlice,
  createQuerySlice,
  defineApplyHandlers,
  type Event,
  type SliceStoreAdapter,
} from '@specter-ts/core'
import { z } from 'zod'

import {
  runCompletedEvent,
  runCreatedEvent,
  runFrameRecordedEvent,
  runStartedEvent,
} from './events'
import type {
  ColonyBenchControlState,
  ColonyBenchRun,
  ColonyBenchRunFrameSummary,
  ColonyBenchRunOverview,
} from './state'

const runFrameSchema = z.object({
  runId: z.string(),
  tick: z.number().int().nonnegative(),
  score: z.number(),
  workerCount: z.number().int().nonnegative(),
  baseLevel: z.number().int().nonnegative(),
  baseEnergy: z.number().nonnegative(),
  commandCount: z.number().int().nonnegative(),
  eventTypes: z.array(z.string()),
})

function cloneRunFrame(
  frame: ColonyBenchRunFrameSummary,
): ColonyBenchRunFrameSummary {
  return { ...frame, eventTypes: [...frame.eventTypes] }
}

function cloneRun(run: ColonyBenchRun): ColonyBenchRun {
  return { ...run }
}

function buildRunOverview(
  state: ColonyBenchControlState,
  runId: string,
): ColonyBenchRunOverview {
  const run = state.runs[runId]
  const frames = state.framesByRunId[runId] ?? []
  const latestFrame = frames[frames.length - 1]

  return {
    run: run ? cloneRun(run) : null,
    frameCount: frames.length,
    latestFrame: latestFrame ? cloneRunFrame(latestFrame) : null,
  }
}

const controlApplyHandlers = defineApplyHandlers(
  [runCreatedEvent, runStartedEvent, runCompletedEvent, runFrameRecordedEvent],
  {
    [runCreatedEvent.type]: async (
      event: Event<typeof runCreatedEvent.type, unknown>,
      state: ColonyBenchControlState,
    ) => {
      const payload = await runCreatedEvent.decode(event.payload)

      if (!state.runs[payload.runId]) {
        state.runOrder.push(payload.runId)
      }

      state.runs[payload.runId] = {
        runId: payload.runId,
        name: payload.name,
        status: state.runs[payload.runId]?.status ?? 'created',
      }
    },
    [runStartedEvent.type]: async (
      event: Event<typeof runStartedEvent.type, unknown>,
      state: ColonyBenchControlState,
    ) => {
      const payload = await runStartedEvent.decode(event.payload)
      const run = state.runs[payload.runId]

      if (run) {
        run.status = 'started'
      }
    },
    [runCompletedEvent.type]: async (
      event: Event<typeof runCompletedEvent.type, unknown>,
      state: ColonyBenchControlState,
    ) => {
      const payload = await runCompletedEvent.decode(event.payload)
      const run = state.runs[payload.runId]

      if (run) {
        run.status = 'completed'
      }
    },
    [runFrameRecordedEvent.type]: async (
      event: Event<typeof runFrameRecordedEvent.type, unknown>,
      state: ColonyBenchControlState,
    ) => {
      const payload = await runFrameRecordedEvent.decode(event.payload)
      const run = state.runs[payload.runId]
      if (!run) return

      const frames = state.framesByRunId[payload.runId] ?? []
      state.framesByRunId[payload.runId] = [...frames, cloneRunFrame(payload)]
    },
  },
)


export function createControlSlices(
  store: SliceStoreAdapter<ColonyBenchControlState>,
) {
  const createRun = createCommandSlice('createRun', 'Creates a ColonyBench run.')
    .schema(
      z.object({
        runId: z.string().optional(),
        name: z.string().optional(),
      }),
    )
    .store(store)
    .handle(async (command) => {
      const name = command.name?.trim() || 'Untitled run'

      return [
        runCreatedEvent.create({
          runId: command.runId ?? crypto.randomUUID(),
          name,
        }),
      ]
    })

  const startRun = createCommandSlice('startRun', 'Starts a ColonyBench run.')
    .schema(
      z.object({
        runId: z.string(),
      }),
    )
    .store(store)
    .apply(controlApplyHandlers)
    .handle(async (command, state) => {
      const run = state.runs[command.runId]

      if (!run) throw new Error(`Run not found: ${command.runId}`)
      if (run.status === 'started') {
        throw new Error(`Run already started: ${command.runId}`)
      }
      if (run.status === 'completed') {
        throw new Error(`Run already completed: ${command.runId}`)
      }

      return [runStartedEvent.create({ runId: command.runId })]
    })

  const completeRun = createCommandSlice(
    'completeRun',
    'Marks a ColonyBench run as completed.',
  )
    .schema(z.object({ runId: z.string() }))
    .store(store)
    .apply(controlApplyHandlers)
    .handle(async (command, state) => {
      const run = state.runs[command.runId]
      if (!run) throw new Error(`Run not found: ${command.runId}`)
      if (run.status !== 'started') {
        throw new Error(`Run not started: ${command.runId}`)
      }

      return [runCompletedEvent.create({ runId: command.runId })]
    })

  const recordRunFrame = createCommandSlice(
    'recordRunFrame',
    'Records a compact live timeline frame for a ColonyBench run.',
  )
    .schema(runFrameSchema)
    .store(store)
    .apply(controlApplyHandlers)
    .handle(async (command, state) => {
      const run = state.runs[command.runId]
      if (!run) throw new Error(`Run not found: ${command.runId}`)

      return [
        runFrameRecordedEvent.create({
          ...command,
          eventTypes: [...command.eventTypes],
        }),
      ]
    })

  const runDetail = createQuerySlice('runDetail', 'Returns one ColonyBench run.')
    .schema(
      z.object({
        runId: z.string(),
      }),
    )
    .store(store)
    .apply(controlApplyHandlers)
    .handle(async (query, state) => state.runs[query.runId] ?? null)

  const runList = createQuerySlice('runList', 'Lists ColonyBench runs.')
    .schema(z.object({}))
    .store(store)
    .apply(controlApplyHandlers)
    .handle(async (_query, state) =>
      state.runOrder.map((runId) => state.runs[runId]).filter((run) => !!run),
    )

  const runTimeline = createQuerySlice(
    'runTimeline',
    'Returns compact live timeline frames for a ColonyBench run.',
  )
    .schema(z.object({ runId: z.string() }))
    .store(store)
    .apply(controlApplyHandlers)
    .handle(async (query, state) =>
      (state.framesByRunId[query.runId] ?? []).map(cloneRunFrame),
    )

  const runOverview = createQuerySlice(
    'runOverview',
    'Returns a UI-friendly ColonyBench run summary with the latest frame.',
  )
    .schema(z.object({ runId: z.string() }))
    .store(store)
    .apply(controlApplyHandlers)
    .handle(async (query, state) => buildRunOverview(state, query.runId))

  return [
    createRun,
    startRun,
    completeRun,
    recordRunFrame,
    runDetail,
    runList,
    runTimeline,
    runOverview,
  ] as const
}
