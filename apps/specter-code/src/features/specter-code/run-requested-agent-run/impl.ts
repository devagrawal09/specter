import runRequestedAgentRunSpec from './spec'

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
          const { permission, target } = permissionForSimulatedTool(
            plan.toolName,
          )
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

const runRequestedAgentRun = runRequestedAgentRunSpec
  .outputSchema<RunRequestedAgentRunCommand>()
  .plugin(async (dispatch) => async (payload, context) => {
    await dispatch(payload as never, {
      idempotencyKey: context.deliveryId,
    })
  })
  .store(
    createMemorySliceStore<RunRequestedAgentRunState>(
      createRunRequestedAgentRunState,
    ),
  )
  .apply(userMessageSubmittedEvent, async (event, state) => {
    const payload = event.payload
    state.messageSessions[payload.messageId] = payload.sessionId
  })
  .apply(agentRunRequestedEvent, async (event, state) => {
    const payload = event.payload
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
  })
  .apply(agentRunStartedEvent, async (event, state) => {
    const payload = event.payload
    state.startedRunIds.add(payload.runId)
  })
  .apply(toolCallStartedEvent, async (event, state) => {
    const payload = event.payload
    const plan = state.runPlans[payload.runId]
    if (plan) plan.toolStarted = true
  })
  .apply(toolApprovalRequestedEvent, async (event, state) => {
    const payload = event.payload
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
  })
  .apply(toolApprovalRepliedEvent, async (event, state) => {
    const payload = event.payload
    const runId = state.approvalRequests[payload.requestId]
    if (!runId) return
    const plan = state.runPlans[runId]
    if (plan) plan.approvalStatus = payload.action
  })
  .apply(toolCallCompletedEvent, async (event, state) => {
    const payload = event.payload
    const plan = state.runPlans[payload.runId]
    if (plan) plan.toolCompleted = true
  })
  .apply(toolCallFailedEvent, async (event, state) => {
    const payload = event.payload
    const plan = state.runPlans[payload.runId]
    if (plan) {
      plan.failed = true
      plan.toolCompleted = true
    }
  })
  .apply(agentRunStreamedEvent, async (event, state) => {
    const payload = event.payload
    const plan = state.runPlans[payload.runId]
    if (plan) plan.streamIndex = payload.sequence + 1
  })
  .apply(agentRunCompletedEvent, async (event, state) => {
    const payload = event.payload
    const plan = state.runPlans[payload.runId]
    if (plan) plan.completed = true
    state.terminalRunIds.add(payload.runId)
  })
  .apply(agentRunFailedEvent, async (event, state) => {
    const payload = event.payload
    const plan = state.runPlans[payload.runId]
    if (plan) plan.failed = true
    state.terminalRunIds.add(payload.runId)
  })

  .handle(async (state): Promise<RunRequestedAgentRunCommand | undefined> => {
    return nextRunRequestedAgentRunCommand(state)
  })

export default runRequestedAgentRun
