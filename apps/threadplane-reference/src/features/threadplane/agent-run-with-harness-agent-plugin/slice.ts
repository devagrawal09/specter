import { createReactionSlice, type Event } from '@specter-ts/core'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import {
  agentRunCompletedEvent,
  agentRunFailedEvent,
  agentRunRequestedEvent,
  agentRunStartedEvent,
} from '../events'

type AgentRunPayload = {
  runId: string
  workspaceId: string
  postId?: string
  agentId: string
  agentName: string
}

type HarnessAgentStreamPart =
  | { type: 'text-delta'; textDelta: string }
  | { type: 'tool-call'; toolCallId?: string; toolName: string; input: unknown }
  | { type: 'tool-result'; toolCallId: string; toolName: string; output: unknown }
  | { type: 'tool-error'; toolCallId: string; toolName: string; error: unknown }

type HarnessAgent = {
  stream(input: AgentRunPayload): AsyncIterable<HarnessAgentStreamPart>
}

type AgentRunState = {
  requestedRuns: AgentRunPayload[]
  startedRunIds: Set<string>
  terminalRunIds: Set<string>
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function createHarnessAgent(): HarnessAgent {
  return {
    // TODO: Replace this placeholder with the AI SDK HarnessAgent factory once the package is available in this app.
    async *stream(input) {
      yield {
        type: 'text-delta',
        textDelta: `${input.agentName} accepted Agent Run ${input.runId}.`,
      }
    },
  }
}

const agentRunWithHarnessAgentPlugin = createReactionSlice(
  'agentRunWithHarnessAgentPlugin',
  'Runs requested Agent Runs through the HarnessAgent adapter.',
)
  .payload<AgentRunPayload>()
  .plugin(async (command) => {
    const agent = createHarnessAgent()

    return async (payload) => {
      const run = payload as AgentRunPayload

      await command({
        type: 'recordAgentRunStarted',
        payload: {
          runId: run.runId,
          workspaceId: run.workspaceId,
          agentId: run.agentId,
        },
      })

      try {
        for await (const part of agent.stream(run)) {
          if (part.type === 'text-delta') {
            await command({
              type: 'recordAgentRunStreamed',
              payload: {
                runId: run.runId,
                workspaceId: run.workspaceId,
                agentId: run.agentId,
                chunkId: crypto.randomUUID(),
                delta: part.textDelta,
              },
            })
          }

          if (part.type === 'tool-call') {
            await command({
              type: 'recordToolCallStarted',
              payload: {
                toolCallId: part.toolCallId ?? crypto.randomUUID(),
                runId: run.runId,
                workspaceId: run.workspaceId,
                agentId: run.agentId,
                toolName: part.toolName,
                input: part.input,
              },
            })
          }

          if (part.type === 'tool-result') {
            await command({
              type: 'recordToolCallCompleted',
              payload: {
                toolCallId: part.toolCallId,
                runId: run.runId,
                workspaceId: run.workspaceId,
                agentId: run.agentId,
                toolName: part.toolName,
                output: part.output,
              },
            })
          }

          if (part.type === 'tool-error') {
            await command({
              type: 'recordToolCallFailed',
              payload: {
                toolCallId: part.toolCallId,
                runId: run.runId,
                workspaceId: run.workspaceId,
                agentId: run.agentId,
                toolName: part.toolName,
                error: formatError(part.error),
              },
            })
          }
        }

        await command({
          type: 'recordAgentRunCompleted',
          payload: {
            runId: run.runId,
            workspaceId: run.workspaceId,
            agentId: run.agentId,
          },
        })
      } catch (error) {
        await command({
          type: 'recordAgentRunFailed',
          payload: {
            runId: run.runId,
            workspaceId: run.workspaceId,
            agentId: run.agentId,
            error: formatError(error),
          },
        })
      }
    }
  })
  .store(
    createMemorySliceStore<AgentRunState>(() => ({
      requestedRuns: [],
      startedRunIds: new Set(),
      terminalRunIds: new Set(),
    })),
  )
  .apply({
    [agentRunRequestedEvent.type]: async (
      event: Event<typeof agentRunRequestedEvent.type, unknown>,
      state: AgentRunState,
    ) => {
      const payload = await agentRunRequestedEvent.decode(event.payload)

      state.requestedRuns.push({
        runId: payload.runId,
        workspaceId: payload.workspaceId,
        postId: payload.postId,
        agentId: payload.agentId,
        agentName: payload.agentName,
      })
    },
    [agentRunStartedEvent.type]: async (
      event: Event<typeof agentRunStartedEvent.type, unknown>,
      state: AgentRunState,
    ) => {
      const payload = await agentRunStartedEvent.decode(event.payload)

      state.startedRunIds.add(payload.runId)
    },
    [agentRunCompletedEvent.type]: async (
      event: Event<typeof agentRunCompletedEvent.type, unknown>,
      state: AgentRunState,
    ) => {
      const payload = await agentRunCompletedEvent.decode(event.payload)

      state.terminalRunIds.add(payload.runId)
    },
    [agentRunFailedEvent.type]: async (
      event: Event<typeof agentRunFailedEvent.type, unknown>,
      state: AgentRunState,
    ) => {
      const payload = await agentRunFailedEvent.decode(event.payload)

      state.terminalRunIds.add(payload.runId)
    },
  })
  .handle(async (state) =>
    state.requestedRuns.find(
      (run) =>
        !state.startedRunIds.has(run.runId) &&
        !state.terminalRunIds.has(run.runId),
    ),
  )

export default agentRunWithHarnessAgentPlugin
