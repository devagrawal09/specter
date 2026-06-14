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
  .apply({})
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
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          toolName: 'searchFiles',
          inputSummary: 'Search for TODO',
        }),
      ],
      when: { workspaceId: 'workspace-1', runId: 'run-1' },
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
  .handle(async (): Promise<AgentRunTimeline> => {
    throw new Error('TODO: implement agentRunTimeline')
  })

export default agentRunTimeline
