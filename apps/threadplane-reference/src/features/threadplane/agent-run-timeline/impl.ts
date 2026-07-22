import specification from './spec.json' with { type: 'json' }
import { implementQuery } from '@specter-ts/core'
import { z } from 'zod'

import { defineMemorySliceStore } from '../../../testing/memory-slice-store'
import {
  agentRunStreamedEvent,
  toolCallCompletedEvent,
  toolCallFailedEvent,
  toolCallStartedEvent,
} from '../events'

type AgentRunTimeline = {
  chunks: {
    chunkId: string
    sequence: number
    delta: string
  }[]
  toolCalls: (
    | {
        toolCallId: string
        toolName: string
        status: 'running'
        inputSummary?: string
      }
    | {
        toolCallId: string
        toolName: string
        status: 'completed'
        inputSummary?: string
        outputSummary?: string
      }
    | {
        toolCallId: string
        toolName: string
        status: 'failed'
        inputSummary?: string
        error: string
      }
  )[]
}

type AgentRunTimelineState = {
  timelines: Record<string, AgentRunTimeline>
}

const getTimeline = (
  state: AgentRunTimelineState,
  runId: string,
): AgentRunTimeline => {
  const existing = state.timelines[runId]
  if (existing) return existing

  const timeline = { chunks: [], toolCalls: [] }
  state.timelines[runId] = timeline
  return timeline
}

const agentRunTimeline = implementQuery(specification)
  .inputSchema(
    z.object({
      workspaceId: z.string(),
      runId: z.string(),
    }),
  )
  .outputSchema<AgentRunTimeline>()
  .store(
    defineMemorySliceStore<AgentRunTimelineState>(() => ({ timelines: {} })),
  )
  .apply(agentRunStreamedEvent, async (event, state) => {
    const payload = event.payload as Awaited<
      ReturnType<typeof agentRunStreamedEvent.decode>
    >
    const timeline = getTimeline(state, payload.runId)
    timeline.chunks.push({
      chunkId: payload.chunkId,
      sequence: payload.sequence,
      delta: payload.delta,
    })
  })
  .apply(toolCallStartedEvent, async (event, state) => {
    const payload = event.payload as Awaited<
      ReturnType<typeof toolCallStartedEvent.decode>
    >
    const timeline = getTimeline(state, payload.runId)
    const existing = timeline.toolCalls.find(
      (toolCall) => toolCall.toolCallId === payload.toolCallId,
    ) as
      | {
          toolCallId: string
          toolName: string
          status: 'running'
          inputSummary?: string
        }
      | {
          toolCallId: string
          toolName: string
          status: 'completed'
          inputSummary?: string
          outputSummary?: string
        }
      | {
          toolCallId: string
          toolName: string
          status: 'failed'
          inputSummary?: string
          error: string
        }
      | undefined
    if (existing) {
      existing.toolName = payload.toolName
      existing.status = 'running'
      existing.inputSummary = payload.inputSummary
    } else {
      timeline.toolCalls.push({
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        status: 'running',
        inputSummary: payload.inputSummary,
      })
    }
  })
  .apply(toolCallCompletedEvent, async (event, state) => {
    const payload = event.payload as Awaited<
      ReturnType<typeof toolCallCompletedEvent.decode>
    >
    const timeline = getTimeline(state, payload.runId)
    const existing = timeline.toolCalls.find(
      (toolCall) => toolCall.toolCallId === payload.toolCallId,
    ) as
      | {
          toolCallId: string
          toolName: string
          status: 'running'
          inputSummary?: string
        }
      | {
          toolCallId: string
          toolName: string
          status: 'completed'
          inputSummary?: string
          outputSummary?: string
        }
      | {
          toolCallId: string
          toolName: string
          status: 'failed'
          inputSummary?: string
          error: string
        }
      | undefined
    if (existing) {
      timeline.toolCalls = timeline.toolCalls.map((toolCall) =>
        toolCall.toolCallId === payload.toolCallId
          ? {
              toolCallId: payload.toolCallId,
              toolName: payload.toolName,
              status: 'completed',
              inputSummary: toolCall.inputSummary,
              outputSummary: payload.outputSummary,
            }
          : toolCall,
      )
    } else {
      timeline.toolCalls.push({
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        status: 'completed',
        outputSummary: payload.outputSummary,
      })
    }
  })
  .apply(toolCallFailedEvent, async (event, state) => {
    const payload = event.payload as Awaited<
      ReturnType<typeof toolCallFailedEvent.decode>
    >
    const timeline = getTimeline(state, payload.runId)
    const existing = timeline.toolCalls.find(
      (toolCall) => toolCall.toolCallId === payload.toolCallId,
    ) as
      | {
          toolCallId: string
          toolName: string
          status: 'running'
          inputSummary?: string
        }
      | {
          toolCallId: string
          toolName: string
          status: 'completed'
          inputSummary?: string
          outputSummary?: string
        }
      | {
          toolCallId: string
          toolName: string
          status: 'failed'
          inputSummary?: string
          error: string
        }
      | undefined
    if (existing) {
      timeline.toolCalls = timeline.toolCalls.map((toolCall) =>
        toolCall.toolCallId === payload.toolCallId
          ? {
              toolCallId: payload.toolCallId,
              toolName: payload.toolName,
              status: 'failed',
              inputSummary: toolCall.inputSummary,
              error: payload.error,
            }
          : toolCall,
      )
    } else {
      timeline.toolCalls.push({
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        status: 'failed',
        error: payload.error,
      })
    }
  })
  .handle(async (query, state): Promise<AgentRunTimeline> => {
    return state.timelines[query.runId] ?? { chunks: [], toolCalls: [] }
  })

export default agentRunTimeline
