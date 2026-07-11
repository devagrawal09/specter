import { describe, expect, it } from 'vitest'

import {
  createRunRequestedAgentRunState,
  nextRunRequestedAgentRunCommand,
} from './impl'

describe('nextRunRequestedAgentRunCommand', () => {
  it('starts a requested run before tool work', () => {
    const state = createRunRequestedAgentRunState()
    state.requestedRuns.push({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      postId: 'post-1',
      agentId: 'specter',
      agentName: 'Specter',
    })
    state.runPlans['run-1'] = {
      toolName: 'searchFiles',
      chunks: ['I found ', 'the issue.'],
      shouldFail: false,
      failed: false,
      completed: false,
      toolStarted: false,
      toolCompleted: false,
      streamIndex: 0,
    }

    expect(nextRunRequestedAgentRunCommand(state)).toEqual({
      type: 'recordAgentRunStarted',
      payload: {
        runId: 'run-1',
        workspaceId: 'workspace-1',
        agentId: 'specter',
      },
    })
  })

  it('emits tool lifecycle and failure branches deterministically', () => {
    const state = createRunRequestedAgentRunState()
    state.requestedRuns.push({
      runId: 'run-fail',
      workspaceId: 'workspace-1',
      postId: 'post-1',
      agentId: 'specter',
      agentName: 'Specter',
    })
    state.runPlans['run-fail'] = {
      toolName: 'searchFiles',
      chunks: ['I found ', 'the issue.'],
      shouldFail: true,
      failed: false,
      completed: false,
      toolStarted: true,
      toolCompleted: false,
      streamIndex: 0,
    }
    state.startedRunIds.add('run-fail')

    expect(nextRunRequestedAgentRunCommand(state)).toEqual({
      type: 'recordToolCallFailed',
      payload: {
        toolCallId: 'run-fail-tool-1',
        runId: 'run-fail',
        workspaceId: 'workspace-1',
        agentId: 'specter',
        toolName: 'searchFiles',
        error: 'Simulated Agent failed while running searchFiles.',
      },
    })
  })

  it('requests tool approval before completing a gated prompt tool call', () => {
    const state = createRunRequestedAgentRunState()
    state.requestedRuns.push({
      runId: 'run-approval',
      workspaceId: 'workspace-1',
      postId: 'message-approval-1',
      agentId: 'specter',
      agentName: 'Specter',
    })
    state.runPlans['run-approval'] = {
      toolName: 'searchFiles',
      chunks: ['I found ', 'the issue.'],
      shouldFail: false,
      failed: false,
      completed: false,
      toolStarted: true,
      toolCompleted: false,
      streamIndex: 0,
    }
    state.startedRunIds.add('run-approval')
    state.messageSessions['message-approval-1'] = 'session-1'

    expect(nextRunRequestedAgentRunCommand(state)).toEqual({
      type: 'requestToolApproval',
      payload: {
        requestId: 'run-approval-tool-1-approval',
        sessionId: 'session-1',
        messageId: 'message-approval-1',
        workspaceId: 'workspace-1',
        agentId: 'specter',
        toolCallId: 'run-approval-tool-1',
        toolName: 'searchFiles',
        permission: 'file.grep',
        target: '**/*',
        reason: 'Agent wants to run searchFiles for this prompt.',
      },
    })
  })

  it('pauses a gated prompt tool call while approval is pending', () => {
    const state = createRunRequestedAgentRunState()
    state.requestedRuns.push({
      runId: 'run-pending',
      workspaceId: 'workspace-1',
      postId: 'message-pending-1',
      agentId: 'specter',
      agentName: 'Specter',
    })
    state.runPlans['run-pending'] = {
      toolName: 'readFile',
      chunks: ['I found ', 'the issue.'],
      shouldFail: false,
      failed: false,
      completed: false,
      toolStarted: true,
      toolCompleted: false,
      streamIndex: 0,
      approvalRequestId: 'run-pending-tool-1-approval',
      approvalStatus: 'pending',
    }
    state.startedRunIds.add('run-pending')
    state.messageSessions['message-pending-1'] = 'session-1'

    expect(nextRunRequestedAgentRunCommand(state)).toBeUndefined()
  })

  it('continues or fails a gated prompt tool call from the approval reply', () => {
    const state = createRunRequestedAgentRunState()
    state.requestedRuns.push({
      runId: 'run-allowed',
      workspaceId: 'workspace-1',
      postId: 'message-allowed-1',
      agentId: 'specter',
      agentName: 'Specter',
    })
    state.runPlans['run-allowed'] = {
      toolName: 'readFile',
      chunks: ['I found ', 'the issue.'],
      shouldFail: false,
      failed: false,
      completed: false,
      toolStarted: true,
      toolCompleted: false,
      streamIndex: 0,
      approvalRequestId: 'run-allowed-tool-1-approval',
      approvalStatus: 'allow',
    }
    state.startedRunIds.add('run-allowed')
    state.messageSessions['message-allowed-1'] = 'session-1'

    expect(nextRunRequestedAgentRunCommand(state)).toEqual({
      type: 'recordToolCallCompleted',
      payload: {
        toolCallId: 'run-allowed-tool-1',
        runId: 'run-allowed',
        workspaceId: 'workspace-1',
        agentId: 'specter',
        toolName: 'readFile',
        outputSummary: 'Simulated readFile output',
      },
    })

    state.requestedRuns.unshift({
      runId: 'run-denied',
      workspaceId: 'workspace-1',
      postId: 'message-denied-1',
      agentId: 'specter',
      agentName: 'Specter',
    })
    state.runPlans['run-denied'] = {
      toolName: 'searchFiles',
      chunks: ['I found ', 'the issue.'],
      shouldFail: false,
      failed: false,
      completed: false,
      toolStarted: true,
      toolCompleted: false,
      streamIndex: 0,
      approvalRequestId: 'run-denied-tool-1-approval',
      approvalStatus: 'deny',
    }
    state.startedRunIds.add('run-denied')
    state.messageSessions['message-denied-1'] = 'session-1'

    expect(nextRunRequestedAgentRunCommand(state)).toEqual({
      type: 'recordToolCallFailed',
      payload: {
        toolCallId: 'run-denied-tool-1',
        runId: 'run-denied',
        workspaceId: 'workspace-1',
        agentId: 'specter',
        toolName: 'searchFiles',
        error: 'Tool denied by user approval: searchFiles.',
      },
    })
  })

  it('does not let one pending approval block later runnable runs', () => {
    const state = createRunRequestedAgentRunState()
    state.requestedRuns.push(
      {
        runId: 'run-pending',
        workspaceId: 'workspace-1',
        postId: 'message-pending-1',
        agentId: 'build',
        agentName: 'Build',
      },
      {
        runId: 'run-ready',
        workspaceId: 'workspace-1',
        postId: 'message-ready-1',
        agentId: 'build',
        agentName: 'Build',
      },
    )
    state.runPlans = {
      'run-pending': {
        toolName: 'readFile',
        shouldFail: false,
        toolStarted: true,
        toolCompleted: false,
        streamIndex: 0,
        chunks: ['Ready.'],
        failed: false,
        completed: false,
        approvalRequestId: 'approval-pending',
        approvalStatus: 'pending',
      },
      'run-ready': {
        toolName: 'searchFiles',
        shouldFail: false,
        toolStarted: false,
        toolCompleted: false,
        streamIndex: 0,
        chunks: ['Ready.'],
        failed: false,
        completed: false,
      },
    }
    state.startedRunIds.add('run-pending')
    state.messageSessions['message-pending-1'] = 'session-1'

    expect(nextRunRequestedAgentRunCommand(state)).toEqual({
      type: 'recordAgentRunStarted',
      payload: {
        runId: 'run-ready',
        workspaceId: 'workspace-1',
        agentId: 'build',
      },
    })
  })

  it('streams and completes once tools are done', () => {
    const state = createRunRequestedAgentRunState()
    state.requestedRuns.push({
      runId: 'run-2',
      workspaceId: 'workspace-1',
      agentId: 'specter',
      agentName: 'Specter',
    })
    state.runPlans['run-2'] = {
      toolName: 'searchFiles',
      chunks: ['I found ', 'the issue.'],
      shouldFail: false,
      failed: false,
      completed: false,
      toolStarted: true,
      toolCompleted: true,
      streamIndex: 0,
    }
    state.startedRunIds.add('run-2')

    expect(nextRunRequestedAgentRunCommand(state)).toEqual({
      type: 'recordAgentRunStreamed',
      payload: {
        chunkId: 'run-2-chunk-1',
        runId: 'run-2',
        workspaceId: 'workspace-1',
        agentId: 'specter',
        sequence: 0,
        delta: 'I found ',
      },
    })

    state.runPlans['run-2'].streamIndex = 2

    expect(nextRunRequestedAgentRunCommand(state)).toEqual({
      type: 'recordAgentRunCompleted',
      payload: {
        runId: 'run-2',
        workspaceId: 'workspace-1',
        agentId: 'specter',
      },
    })
  })
})
