import { createReactionSlice } from '@specter-ts/core'

import { createMemorySliceStore } from '../../../testing/memory-slice-store'

type AgentReactionPayload = {
  triggerId: string
  workspaceId: string
  postId: string
  agentId: string
}

type AgentReactionState = {
  triggerIds: Set<string>
  completedTriggerIds: Set<string>
}

const agentReactionWithMastraPlugin = createReactionSlice(
  'agentReactionWithMastraPlugin',
  'Runs the Mastra-backed agent reaction for triggered agent work.',
)
  .payload<AgentReactionPayload>()
  .plugin(async () => async () => undefined)
  .store(
    createMemorySliceStore<AgentReactionState>(() => ({
      triggerIds: new Set(),
      completedTriggerIds: new Set(),
    })),
  )

export default agentReactionWithMastraPlugin
