import { createReactionSlice } from '@specter-ts/core'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import {
  agentRunCompletedEvent,
  agentRunFailedEvent,
  agentRunRequestedEvent,
  agentRunStartedEvent,
  agentRunStreamedEvent,
  toolApprovalRepliedEvent,
  toolApprovalRequestedEvent,
  toolCallCompletedEvent,
  toolCallFailedEvent,
  toolCallStartedEvent,
  userMessageSubmittedEvent,
} from '../events'
import {
  buildFailureMessage,
  buildStreamChunks,
  getSimulatedAgentPlan,
  pickToolName,
  shouldFailRun,
} from '../simulated-agent-plan'

type AgentRunJob = {
  runId: string
  workspaceId: string
  postId?: string
  agentId: string
  agentName: string
}

type RunRequestedAgentRunCommand =
  | {
      type: 'recordAgentRunStarted'
      payload: {
        runId: string
        workspaceId: string
        agentId: string
      }
    }
  | {
      type: 'recordToolCallStarted'
      payload: {
        toolCallId: string
        runId: string
        workspaceId: string
        agentId: string
        toolName: string
        inputSummary?: string
      }
    }
  | {
      type: 'recordToolCallCompleted'
      payload: {
        toolCallId: string
        runId: string
        workspaceId: string
        agentId: string
        toolName: string
        outputSummary?: string
      }
    }
  | {
      type: 'recordToolCallFailed'
      payload: {
        toolCallId: string
        runId: string
        workspaceId: string
        agentId: string
        toolName: string
        error: string
      }
    }
  | {
      type: 'requestToolApproval'
      payload: {
        requestId: string
        sessionId: string
        messageId: string
        workspaceId: string
        agentId: string
        toolCallId: string
        toolName: string
        permission: string
        target: string
        reason: string
      }
    }
  | {
      type: 'recordAgentRunStreamed'
      payload: {
        runId: string
        workspaceId: string
        agentId: string
        chunkId: string
        sequence: number
        delta: string
      }
    }
  | {
      type: 'recordAgentRunCompleted'
      payload: {
        runId: string
        workspaceId: string
        agentId: string
      }
    }
  | {
      type: 'recordAgentRunFailed'
      payload: {
        runId: string
        workspaceId: string
        agentId: string
        error: string
      }
    }

type RunRequestedAgentRunState = {
  requestedRuns: AgentRunJob[]
  runPlans: Record<
    string,
    {
      toolName: string
      chunks: string[]
      shouldFail: boolean
      failed: boolean
      completed: boolean
      toolStarted: boolean
      toolCompleted: boolean
      streamIndex: number
      approvalRequestId?: string
      approvalStatus?: 'pending' | 'allow' | 'deny'
    }
  >
  messageSessions: Record<string, string>
  approvalRequests: Record<string, string>
  startedRunIds: Set<string>
  terminalRunIds: Set<string>
}

export function createRunRequestedAgentRunState(): RunRequestedAgentRunState {
  return {
    requestedRuns: [],
    runPlans: {},
    messageSessions: {},
    approvalRequests: {},
    startedRunIds: new Set(),
    terminalRunIds: new Set(),
  }
}

function toolCallIdForRun(runId: string) {
  return `${runId}-tool-1`
}

function approvalRequestIdForToolCall(toolCallId: string) {
  return `${toolCallId}-approval`
}

function permissionForSimulatedTool(toolName: string) {
  if (toolName === 'shell') {
    return { permission: 'shell.execute', target: 'pnpm test' }
  }

  if (toolName === 'readFile' || toolName === 'inspectWorkspace') {
    return { permission: 'file.read', target: 'workspace' }
  }

  if (toolName === 'searchFiles') {
    return { permission: 'file.grep', target: '**/*' }
  }

  return { permission: `tool.${toolName}`, target: toolName }
}

export function nextRunRequestedAgentRunCommand(
  state: RunRequestedAgentRunState,
): RunRequestedAgentRunCommand | undefined {
  for (const nextRun of state.requestedRuns) {
    if (state.terminalRunIds.has(nextRun.runId)) continue

    const plan = state.runPlans[nextRun.runId]
    if (!plan) continue

    if (!state.startedRunIds.has(nextRun.runId)) {
      return {
        type: 'recordAgentRunStarted',
        payload: {
          runId: nextRun.runId,
          workspaceId: nextRun.workspaceId,
          agentId: nextRun.agentId,
        },
      }
    }

    if (!plan.toolStarted) {
      return {
        type: 'recordToolCallStarted',
        payload: {
          toolCallId: toolCallIdForRun(nextRun.runId),
          runId: nextRun.runId,
          workspaceId: nextRun.workspaceId,
          agentId: nextRun.agentId,
          toolName: plan.toolName,
          inputSummary: 'Simulated workspace inspection',
        },
      }
    }

    if (!plan.toolCompleted) {
      const toolCallId = toolCallIdForRun(nextRun.runId)
      const promptMessageId = nextRun.postId
      const promptSessionId = promptMessageId
        ? state.messageSessions[promptMessageId]
        : undefined

      if (promptMessageId && promptSessionId) {
        if (!plan.approvalRequestId) {
          const requestId = approvalRequestIdForToolCall(toolCallId)
          const { permission, target } = permissionForSimulatedTool(plan.toolName)
          return {
            type: 'requestToolApproval',
            payload: {
              requestId,
              sessionId: promptSessionId,
              messageId: promptMessageId,
              workspaceId: nextRun.workspaceId,
              agentId: nextRun.agentId,
              toolCallId,
              toolName: plan.toolName,
              permission,
              target,
              reason: `Agent wants to run ${plan.toolName} for this prompt.`,
            },
          }
        }

        if (plan.approvalStatus === 'pending') continue

        if (plan.approvalStatus === 'deny') {
          return {
            type: 'recordToolCallFailed',
            payload: {
              toolCallId,
              runId: nextRun.runId,
              workspaceId: nextRun.workspaceId,
              agentId: nextRun.agentId,
              toolName: plan.toolName,
              error: `Tool denied by user approval: ${plan.toolName}.`,
            },
          }
        }
      }

      if (plan.shouldFail && !plan.failed) {
        return {
          type: 'recordToolCallFailed',
          payload: {
            toolCallId,
            runId: nextRun.runId,
            workspaceId: nextRun.workspaceId,
            agentId: nextRun.agentId,
            toolName: plan.toolName,
            error: buildFailureMessage(plan.toolName),
          },
        }
      }

      return {
        type: 'recordToolCallCompleted',
        payload: {
          toolCallId,
          runId: nextRun.runId,
          workspaceId: nextRun.workspaceId,
          agentId: nextRun.agentId,
          toolName: plan.toolName,
          outputSummary: `Simulated ${plan.toolName} output`,
        },
      }
    }

    if (plan.shouldFail || plan.failed) {
      return {
        type: 'recordAgentRunFailed',
        payload: {
          runId: nextRun.runId,
          workspaceId: nextRun.workspaceId,
          agentId: nextRun.agentId,
          error: buildFailureMessage(plan.toolName),
        },
      }
    }

    if (plan.streamIndex < plan.chunks.length) {
      return {
        type: 'recordAgentRunStreamed',
        payload: {
          chunkId: `${nextRun.runId}-chunk-${plan.streamIndex + 1}`,
          runId: nextRun.runId,
          workspaceId: nextRun.workspaceId,
          agentId: nextRun.agentId,
          sequence: plan.streamIndex,
          delta: plan.chunks[plan.streamIndex],
        },
      }
    }

    return {
      type: 'recordAgentRunCompleted',
      payload: {
        runId: nextRun.runId,
        workspaceId: nextRun.workspaceId,
        agentId: nextRun.agentId,
      },
    }
  }

  return undefined
}

const runRequestedAgentRun = createReactionSlice(
  'runRequestedAgentRun',
  'Executes requested Agent Runs through the configured agent plugin.',
)
  .payload<RunRequestedAgentRunCommand>()
  .plugin(async (dispatch) => async (payload) => {
    await dispatch(payload as never)
  })
  .store(
    createMemorySliceStore<RunRequestedAgentRunState>(
      createRunRequestedAgentRunState,
    ),
  )
  .apply({
    [userMessageSubmittedEvent.type]: async (event, state) => {
      const payload = await userMessageSubmittedEvent.decode(event.payload)
      state.messageSessions[payload.messageId] = payload.sessionId
    },
    [agentRunRequestedEvent.type]: async (event, state) => {
      const payload = await agentRunRequestedEvent.decode(event.payload)
      const plan = getSimulatedAgentPlan(payload.runId)

      state.requestedRuns.push(payload)
      state.runPlans[payload.runId] = {
        toolName: pickToolName(plan.seed, payload.runId),
        chunks: buildStreamChunks(plan.seed, payload.runId),
        shouldFail: shouldFailRun(plan.seed, payload.runId),
        failed: false,
        completed: false,
        toolStarted: false,
        toolCompleted: false,
        streamIndex: 0,
      }
    },
    [agentRunStartedEvent.type]: async (event, state) => {
      const payload = await agentRunStartedEvent.decode(event.payload)
      state.startedRunIds.add(payload.runId)
    },
    [toolCallStartedEvent.type]: async (event, state) => {
      const payload = await toolCallStartedEvent.decode(event.payload)
      const plan = state.runPlans[payload.runId]
      if (plan) plan.toolStarted = true
    },
    [toolApprovalRequestedEvent.type]: async (event, state) => {
      const payload = await toolApprovalRequestedEvent.decode(event.payload)
      if (!payload.toolCallId) return
      const run = state.requestedRuns.find(
        (candidate) => toolCallIdForRun(candidate.runId) === payload.toolCallId,
      )
      if (!run) return
      const plan = state.runPlans[run.runId]
      if (!plan) return
      plan.approvalRequestId = payload.requestId
      plan.approvalStatus = 'pending'
      state.approvalRequests[payload.requestId] = run.runId
    },
    [toolApprovalRepliedEvent.type]: async (event, state) => {
      const payload = await toolApprovalRepliedEvent.decode(event.payload)
      const runId = state.approvalRequests[payload.requestId]
      if (!runId) return
      const plan = state.runPlans[runId]
      if (plan) plan.approvalStatus = payload.action
    },
    [toolCallCompletedEvent.type]: async (event, state) => {
      const payload = await toolCallCompletedEvent.decode(event.payload)
      const plan = state.runPlans[payload.runId]
      if (plan) plan.toolCompleted = true
    },
    [toolCallFailedEvent.type]: async (event, state) => {
      const payload = await toolCallFailedEvent.decode(event.payload)
      const plan = state.runPlans[payload.runId]
      if (plan) {
        plan.failed = true
        plan.toolCompleted = true
      }
    },
    [agentRunStreamedEvent.type]: async (event, state) => {
      const payload = await agentRunStreamedEvent.decode(event.payload)
      const plan = state.runPlans[payload.runId]
      if (plan) plan.streamIndex = payload.sequence + 1
    },
    [agentRunCompletedEvent.type]: async (event, state) => {
      const payload = await agentRunCompletedEvent.decode(event.payload)
      const plan = state.runPlans[payload.runId]
      if (plan) plan.completed = true
      state.terminalRunIds.add(payload.runId)
    },
    [agentRunFailedEvent.type]: async (event, state) => {
      const payload = await agentRunFailedEvent.decode(event.payload)
      const plan = state.runPlans[payload.runId]
      if (plan) plan.failed = true
      state.terminalRunIds.add(payload.runId)
    },
  })
  .scenarios(
    {
      description: 'Queues a requested Agent Run that has not started.',
      given: [
        agentRunRequestedEvent.create({
          runId: 'run-1',
          workspaceId: 'workspace-1',
          postId: 'post-1',
          agentId: 'specter',
          agentName: 'Specter',
          requestedBy: { type: 'user', displayName: 'Ada' },
        }),
      ],
      expect: [
        {
          type: 'recordAgentRunStarted',
          payload: {
            runId: 'run-1',
            workspaceId: 'workspace-1',
            agentId: 'specter',
          },
        },
      ],
    },
    {
      description: 'Continues an Agent Run that already started.',
      given: [
        agentRunRequestedEvent.create({
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          agentName: 'Specter',
          requestedBy: { type: 'system' },
        }),
        agentRunStartedEvent.create({
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
        }),
      ],
      expect: [
        {
          type: 'recordToolCallStarted',
          payload: {
            toolCallId: 'run-1-tool-1',
            runId: 'run-1',
            workspaceId: 'workspace-1',
            agentId: 'specter',
            toolName: 'searchFiles',
            inputSummary: 'Simulated workspace inspection',
          },
        },
      ],
    },
    {
      description:
        'Does not queue an Agent Run that already reached a terminal state.',
      given: [
        agentRunRequestedEvent.create({
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          agentName: 'Specter',
          requestedBy: { type: 'system' },
        }),
        agentRunFailedEvent.create({
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          error: 'Agent runtime unavailable',
        }),
        agentRunRequestedEvent.create({
          runId: 'run-2',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          agentName: 'Specter',
          requestedBy: { type: 'system' },
        }),
        agentRunCompletedEvent.create({
          runId: 'run-2',
          workspaceId: 'workspace-1',
          agentId: 'specter',
        }),
      ],
      expect: [],
    },
  )
  .handle(async (state): Promise<RunRequestedAgentRunCommand | undefined> => {
    return nextRunRequestedAgentRunCommand(state)
  })

export default runRequestedAgentRun
