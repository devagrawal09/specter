import { createQuerySlice } from '@specter-ts/core'
import { z } from 'zod'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
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

const agentRunTimeline = createQuerySlice(
  'agentRunTimeline',
  'Shows streamed text chunks and tool calls for one Agent Run.',
)
  .schema(
    z.object({
      workspaceId: z.string(),
      runId: z.string(),
    }),
  )
  .store(
    createMemorySliceStore<AgentRunTimelineState>(() => ({ timelines: {} })),
  )
  .apply({
    [agentRunStreamedEvent.type]: async (event, state) => {
      const payload = await agentRunStreamedEvent.decode(event.payload)
      const timeline = getTimeline(state, payload.runId)
      timeline.chunks.push({
        chunkId: payload.chunkId,
        sequence: payload.sequence,
        delta: payload.delta,
      })
    },
    [toolCallStartedEvent.type]: async (event, state) => {
      const payload = await toolCallStartedEvent.decode(event.payload)
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
    },
    [toolCallCompletedEvent.type]: async (event, state) => {
      const payload = await toolCallCompletedEvent.decode(event.payload)
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
    },
    [toolCallFailedEvent.type]: async (event, state) => {
      const payload = await toolCallFailedEvent.decode(event.payload)
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
    },
  })
  .scenarios(
    {
      description:
        'Shows streamed text and terminal tool call statuses for an Agent Run.',
      given: [
        agentRunStreamedEvent.create({
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          chunkId: 'chunk-1',
          sequence: 0,
          delta: 'I found ',
        }),
        toolCallStartedEvent.create({
          toolCallId: 'tool-call-1',
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          toolName: 'readFile',
          inputSummary: 'Read src/index.ts',
        }),
        toolCallCompletedEvent.create({
          toolCallId: 'tool-call-1',
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          toolName: 'readFile',
          outputSummary: 'Read 9 bytes from src/index.ts',
        }),
        toolCallStartedEvent.create({
          toolCallId: 'tool-call-2',
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          toolName: 'readFile',
          inputSummary: 'Read missing.ts',
        }),
        toolCallFailedEvent.create({
          toolCallId: 'tool-call-2',
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          toolName: 'readFile',
          error: 'File not found',
        }),
        agentRunStreamedEvent.create({
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          chunkId: 'chunk-2',
          sequence: 1,
          delta: 'the issue.',
        }),
      ],
      when: { workspaceId: 'workspace-1', runId: 'run-1' },
      expect: {
        chunks: [
          { chunkId: 'chunk-1', sequence: 0, delta: 'I found ' },
          { chunkId: 'chunk-2', sequence: 1, delta: 'the issue.' },
        ],
        toolCalls: [
          {
            toolCallId: 'tool-call-1',
            toolName: 'readFile',
            status: 'completed',
            inputSummary: 'Read src/index.ts',
            outputSummary: 'Read 9 bytes from src/index.ts',
          },
          {
            toolCallId: 'tool-call-2',
            toolName: 'readFile',
            status: 'failed',
            inputSummary: 'Read missing.ts',
            error: 'File not found',
          },
        ],
      },
    },
    {
      description: 'Shows a running tool call before it completes or fails.',
      given: [
        toolCallStartedEvent.create({
          toolCallId: 'tool-call-1',
          runId: 'run-2',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          toolName: 'searchFiles',
          inputSummary: 'Search for TODO',
        }),
      ],
      when: { workspaceId: 'workspace-1', runId: 'run-2' },
      expect: {
        chunks: [],
        toolCalls: [
          {
            toolCallId: 'tool-call-1',
            toolName: 'searchFiles',
            status: 'running',
            inputSummary: 'Search for TODO',
          },
        ],
      },
    },
  )
  .handle(async (query, state): Promise<AgentRunTimeline> => {
    return state.timelines[query.runId] ?? { chunks: [], toolCalls: [] }
  })

export default agentRunTimeline
