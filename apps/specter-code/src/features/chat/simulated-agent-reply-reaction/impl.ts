import simulatedAgentReplyReactionSpec from './spec'

import { createSqliteSliceStore } from '../../../db/specter-sqlite'
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

type RecordAgentReplyCommand = {
  type: 'recordAgentReply'
  payload: {
    messageId: string
    workspaceId: string
    replyToMessageId: string
    agentId: string
    agentName: string
    content: string
  }
}

const simulatedAgentReplyReaction = simulatedAgentReplyReactionSpec
  .outputSchema<RecordAgentReplyCommand>()
  .plugin(async (command) => async (payload) => command(payload as never))
  .store(createSqliteSliceStore<SimulatedAgentReplyState>(() => ({
      messages: [],
      repliedToMessageIds: new Set(),
    })))
  .apply(messagePostedEvent, async (event, state) => {
      const payload = event.payload

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
        messageId: `${message.id}-reply`,
        workspaceId: message.workspaceId,
        replyToMessageId: message.id,
        agentId: 'specter',
        agentName: 'Specter',
        content: `Specter heard: ${message.content}`,
      },
    }
  })

export default simulatedAgentReplyReaction
