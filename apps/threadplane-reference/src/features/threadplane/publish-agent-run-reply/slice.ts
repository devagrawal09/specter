import { createReactionSlice } from '@specter-ts/core'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import {
  agentRunCompletedEvent,
  agentRunFailedEvent,
  agentRunRequestedEvent,
  agentRunStreamedEvent,
} from '../events'

type RecordVisibleAgentReplyCommand = {
  type: 'recordVisibleAgentReply'
  payload: {
    workspaceId: string
    parentPostId: string
    runId: string
    agentId: string
    agentName: string
    content: string
  }
}

type PublishAgentRunReplyState = {
  runs: {
    runId: string
    workspaceId: string
    postId?: string
    agentId: string
    agentName: string
    text: string
    completed: boolean
    failed: boolean
    replyPublished: boolean
  }[]
}

const publishAgentRunReply = createReactionSlice(
  'publishAgentRunReply',
  'Requests a visible chat reply when an Agent Run completes with streamed text.',
)
  .payload<RecordVisibleAgentReplyCommand>()
  .plugin(async (dispatch) => async (payload) => {
    await dispatch(payload as never)
  })
  .store(
    createMemorySliceStore<PublishAgentRunReplyState>(() => ({ runs: [] })),
  )
  .apply({
    [agentRunRequestedEvent.type]: async (event, state) => {
      const payload = await agentRunRequestedEvent.decode(event.payload)

      state.runs.push({
        runId: payload.runId,
        workspaceId: payload.workspaceId,
        postId: payload.postId,
        agentId: payload.agentId,
        agentName: payload.agentName,
        text: '',
        completed: false,
        failed: false,
        replyPublished: false,
      })
    },
    [agentRunStreamedEvent.type]: async (event, state) => {
      const payload = await agentRunStreamedEvent.decode(event.payload)
      const run = state.runs.find((item) => item.runId === payload.runId)

      if (run) run.text += payload.delta
    },
    [agentRunCompletedEvent.type]: async (event, state) => {
      const payload = await agentRunCompletedEvent.decode(event.payload)
      const run = state.runs.find((item) => item.runId === payload.runId)

      if (run) run.completed = true
    },
    [agentRunFailedEvent.type]: async (event, state) => {
      const payload = await agentRunFailedEvent.decode(event.payload)
      const run = state.runs.find((item) => item.runId === payload.runId)

      if (run) run.failed = true
    },
  })
  .scenarios(
    {
      description:
        'Requests a visible agent reply after a post-targeted Agent Run completes.',
      given: [
        agentRunRequestedEvent.create({
          runId: 'run-1',
          workspaceId: 'workspace-1',
          postId: 'post-1',
          agentId: 'specter',
          agentName: 'Specter',
          requestedBy: { type: 'user', displayName: 'Ada' },
        }),
        agentRunStreamedEvent.create({
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          chunkId: 'chunk-1',
          sequence: 0,
          delta: 'I found ',
        }),
        agentRunStreamedEvent.create({
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          chunkId: 'chunk-2',
          sequence: 1,
          delta: 'the issue.',
        }),
        agentRunCompletedEvent.create({
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
        }),
      ],
      expect: [
        {
          type: 'recordVisibleAgentReply',
          payload: {
            workspaceId: 'workspace-1',
            parentPostId: 'post-1',
            runId: 'run-1',
            agentId: 'specter',
            agentName: 'Specter',
            content: 'I found the issue.',
          },
        },
      ],
    },
    {
      description: 'Does not publish a visible reply for a failed Agent Run.',
      given: [
        agentRunRequestedEvent.create({
          runId: 'run-1',
          workspaceId: 'workspace-1',
          postId: 'post-1',
          agentId: 'specter',
          agentName: 'Specter',
          requestedBy: { type: 'user', displayName: 'Ada' },
        }),
        agentRunFailedEvent.create({
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          error: 'Agent runtime unavailable',
        }),
      ],
      expect: [],
    },
    {
      description:
        'Does not publish a visible reply for a run without a post target.',
      given: [
        agentRunRequestedEvent.create({
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
          agentName: 'Specter',
          requestedBy: { type: 'system' },
        }),
        agentRunCompletedEvent.create({
          runId: 'run-1',
          workspaceId: 'workspace-1',
          agentId: 'specter',
        }),
      ],
      expect: [],
    },
  )
  .handle(
    async (state): Promise<RecordVisibleAgentReplyCommand | undefined> => {
      const run = state.runs.find(
        (item) =>
          item.postId && item.completed && !item.failed && !item.replyPublished,
      )

      if (!run || !run.postId || !run.text.trim()) {
        return undefined
      }

      run.replyPublished = true

      return {
        type: 'recordVisibleAgentReply',
        payload: {
          workspaceId: run.workspaceId,
          parentPostId: run.postId,
          runId: run.runId,
          agentId: run.agentId,
          agentName: run.agentName,
          content: run.text.trim(),
        },
      }
    },
  )

export default publishAgentRunReply
