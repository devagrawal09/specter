import { NonNegativeInt } from '@ocpp/schema/schema'
import type { SessionError } from '@ocpp/schema/session-error'
import { SessionID } from '@ocpp/schema/session-id'
import { SessionMessage } from '@ocpp/schema/session-message'
import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

const DEFAULT_LIMIT = 3

// Rebuildable projection: active executions and, per step, its status, the
// latest failure, and how many retries were scheduled. The retried event
// carries the failure from here, so the caller cannot misreport it.
export type ScheduleRetryState = {
  active: Record<string, true>
  steps: Record<
    string,
    {
      sessionID: string
      status: 'started' | 'ended' | 'failed' | 'retrying'
      retries: number
      error?: SessionError.Error
    }
  >
}

export const scheduleRetryStore = Context.Service<
  SliceStoreService<ScheduleRetryState, ScheduleRetryState, unknown>
>('@specter/agent-runtime/ScheduleRetryStore')

export const createScheduleRetryState = (): ScheduleRetryState => ({
  active: {},
  steps: {},
})

const executionStarted = sessionEvent('session-execution-started')
const executionSucceeded = sessionEvent('session-execution-succeeded')
const executionFailed = sessionEvent('session-execution-failed')
const executionInterrupted = sessionEvent('session-execution-interrupted')
const stepStarted = sessionEvent('session-step-started')
const stepEnded = sessionEvent('session-step-ended')
const stepFailed = sessionEvent('session-step-failed')
const retryScheduled = sessionEvent('session-retry-scheduled')

const input = Schema.toStandardSchemaV1(
  Schema.Struct({
    sessionID: SessionID,
    assistantMessageID: SessionMessage.ID,
    at: NonNegativeInt,
    limit: Schema.optional(NonNegativeInt),
  }),
)

const end = (state: ScheduleRetryState, sessionID: string) => {
  delete state.active[sessionID]
}

export const scheduleRetry = implementCommand(specification)
  .inputSchema(input)
  .store(scheduleRetryStore)
  .apply(executionStarted, async (event, state) => {
    state.active[event.payload.sessionID] = true
  })
  .apply(executionSucceeded, async (event, state) => {
    end(state, event.payload.sessionID)
  })
  .apply(executionFailed, async (event, state) => {
    end(state, event.payload.sessionID)
  })
  .apply(executionInterrupted, async (event, state) => {
    end(state, event.payload.sessionID)
  })
  .apply(stepStarted, async (event, state) => {
    const { sessionID, assistantMessageID } = event.payload
    const step = state.steps[assistantMessageID]
    if (step) step.status = 'started'
    else
      state.steps[assistantMessageID] = {
        sessionID,
        status: 'started',
        retries: 0,
      }
  })
  .apply(stepEnded, async (event, state) => {
    const step = state.steps[event.payload.assistantMessageID]
    if (step) step.status = 'ended'
  })
  .apply(stepFailed, async (event, state) => {
    const step = state.steps[event.payload.assistantMessageID]
    if (!step) return
    step.status = 'failed'
    step.error = event.payload.error
  })
  .apply(retryScheduled, async (event, state) => {
    const step = state.steps[event.payload.assistantMessageID]
    if (!step) return
    step.status = 'retrying'
    step.retries += 1
  })
  .handle(async (command, state) => {
    if (!state.active[command.sessionID])
      throw new Error('Execution not active')
    const step = state.steps[command.assistantMessageID]
    if (
      !step ||
      step.sessionID !== command.sessionID ||
      step.status !== 'failed' ||
      !step.error
    )
      throw new Error('Step not failed')
    if (step.retries >= (command.limit ?? DEFAULT_LIMIT))
      throw new Error('Retry limit reached')
    return [
      retryScheduled.create({
        sessionID: command.sessionID,
        assistantMessageID: command.assistantMessageID,
        attempt: step.retries + 1,
        at: command.at,
        error: step.error,
      }),
    ]
  })
