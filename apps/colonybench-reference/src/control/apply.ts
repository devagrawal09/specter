import type { EventForDefinition } from '@specter-ts/core'

import type {
  runCompletedEvent,
  runCreatedEvent,
  runFrameRecordedEvent,
  runStartedEvent,
} from './events'
import type {
  ColonyBenchControlState,
  ColonyBenchRunFrameSummary,
} from './state'

export function cloneRunFrame(
  frame: ColonyBenchRunFrameSummary,
): ColonyBenchRunFrameSummary {
  return { ...frame, eventTypes: [...frame.eventTypes] }
}

export async function applyRunCreated(
  event: EventForDefinition<typeof runCreatedEvent>,
  state: ColonyBenchControlState,
) {
  const payload = event.payload
  if (!state.runs[payload.runId]) state.runOrder.push(payload.runId)
  state.runs[payload.runId] = {
    runId: payload.runId,
    name: payload.name,
    status: state.runs[payload.runId]?.status ?? 'created',
  }
}

export async function applyRunStarted(
  event: EventForDefinition<typeof runStartedEvent>,
  state: ColonyBenchControlState,
) {
  const run = state.runs[event.payload.runId]
  if (run) run.status = 'started'
}

export async function applyRunCompleted(
  event: EventForDefinition<typeof runCompletedEvent>,
  state: ColonyBenchControlState,
) {
  const run = state.runs[event.payload.runId]
  if (run) run.status = 'completed'
}

export async function applyRunFrameRecorded(
  event: EventForDefinition<typeof runFrameRecordedEvent>,
  state: ColonyBenchControlState,
) {
  const payload = event.payload
  if (!state.runs[payload.runId]) return
  const frames = state.framesByRunId[payload.runId] ?? []
  state.framesByRunId[payload.runId] = [...frames, cloneRunFrame(payload)]
}
