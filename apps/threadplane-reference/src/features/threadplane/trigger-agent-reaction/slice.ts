import { createReactionSlice } from '@specter-ts/core'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'

type TriggerAgentCommand = {
  type: 'triggerAgent'
  payload: {
    workspaceId: string
    postId: string
    agentId: string
    agentName: string
  }
}

type TriggerAgentReactionState = {
  postIds: Set<string>
  triggeredPostIds: Set<string>
}

const triggerAgentReaction = createReactionSlice(
  'triggerAgentReaction',
  'Requests agent work for posts that should trigger an agent.',
)
  .payload<TriggerAgentCommand>()
  .plugin(async (command) => async (payload) => command(payload as never))
  .store(
    createMemorySliceStore<TriggerAgentReactionState>(() => ({
      postIds: new Set(),
      triggeredPostIds: new Set(),
    })),
  )

export default triggerAgentReaction
