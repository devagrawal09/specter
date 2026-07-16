import publishAgentRunReplySpec from './spec'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import {
  agentRunCompletedEvent,
  agentRunFailedEvent,
  agentRunRequestedEvent,
  agentRunStreamedEvent,
  postReplyCreatedEvent,
} from '../events'

type RecordVisibleAgentReplyCommand = {
  type: 'recordVisibleAgentReply'
  payload: {
    replyId: string
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

const publishAgentRunReply = publishAgentRunReplySpec
  .outputSchema<RecordVisibleAgentReplyCommand>()
  .plugin(async (dispatch) => async (payload, context) => {
    await dispatch(payload as never, {
      idempotencyKey: context.deliveryId,
    })
  })
  .store(
    createMemorySliceStore<PublishAgentRunReplyState>(() => ({ runs: [] })),
  )
  .apply(agentRunRequestedEvent, async (event, state) => {
    const payload = event.payload

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
  })
  .apply(agentRunStreamedEvent, async (event, state) => {
    const payload = event.payload
    const run = state.runs.find((item) => item.runId === payload.runId)

    if (run) run.text += payload.delta
  })
  .apply(agentRunCompletedEvent, async (event, state) => {
    const payload = event.payload
    const run = state.runs.find((item) => item.runId === payload.runId)

    if (run) run.completed = true
  })
  .apply(agentRunFailedEvent, async (event, state) => {
    const payload = event.payload
    const run = state.runs.find((item) => item.runId === payload.runId)

    if (run) run.failed = true
  })
  .apply(postReplyCreatedEvent, async (event, state) => {
    const payload = event.payload
    if (!payload.sourceRunId) return

    const run = state.runs.find((item) => item.runId === payload.sourceRunId)
    if (run) run.replyPublished = true
  })
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
          replyId: `${run.runId}-reply`,
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
