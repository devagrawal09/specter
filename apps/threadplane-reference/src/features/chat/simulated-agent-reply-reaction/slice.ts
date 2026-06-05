import { createReactionSlice } from '@specter-ts/core'
import type { Event } from '@specter-ts/core'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'
import { messagePostedEvent } from '../events'

type AgentReplyMessage = {
  id: string
  workspaceId: string
  authorType: 'user' | 'agent'
  content: string
  parentMessageId?: string
}

type SimulatedAgentReplyState = {
  messages: AgentReplyMessage[]
  repliedToMessageIds: Set<string>
}

const simulatedAgentReplyReaction = createReactionSlice(
  'simulatedAgentReplyReaction',
  'Requests a deterministic agent reply when Specter is mentioned.',
)
  .plugin(async (command) => async (payload) => command(payload as never))
  .store(
    createMemorySliceStore<SimulatedAgentReplyState>(() => ({
      messages: [],
      repliedToMessageIds: new Set(),
    })),
  )
  .apply({
    [messagePostedEvent.type]: async (
      event: Event<typeof messagePostedEvent.type, unknown>,
      state: SimulatedAgentReplyState,
    ) => {
      const payload = await messagePostedEvent.decode(event.payload)

      state.messages.push({
        id: payload.messageId,
        workspaceId: payload.workspaceId,
        authorType: payload.author.type,
        content: payload.content,
        parentMessageId: payload.parentMessageId,
      })

      if (payload.author.type === 'agent' && payload.parentMessageId) {
        state.repliedToMessageIds.add(payload.parentMessageId)
      }
    },
  })
  .scenarios({
    description: 'Requests an agent reply when Specter is mentioned.',
    given: [
      messagePostedEvent.create({
        messageId: 'message-1',
        workspaceId: 'workspace-1',
        author: { type: 'user', displayName: 'Ada Lovelace' },
        content: 'Can @specter help with this?',
      }),
    ],
    expect: [
      {
        type: 'recordAgentReply',
        payload: {
          workspaceId: 'workspace-1',
          replyToMessageId: 'message-1',
          agentId: 'specter',
          agentName: 'Specter',
          content: 'Specter heard: Can @specter help with this?',
        },
      },
    ],
  })
  .handle(async (state) => {
    const message = state.messages.find(
      (item) =>
        item.authorType === 'user' &&
        item.content.toLowerCase().includes('@specter') &&
        !state.repliedToMessageIds.has(item.id),
    )

    if (!message) {
      return undefined
    }

    return {
      type: 'recordAgentReply',
      payload: {
        workspaceId: message.workspaceId,
        replyToMessageId: message.id,
        agentId: 'specter',
        agentName: 'Specter',
        content: `Specter heard: ${message.content}`,
      },
    }
  })

export default simulatedAgentReplyReaction
