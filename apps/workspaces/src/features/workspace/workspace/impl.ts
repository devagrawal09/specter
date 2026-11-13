import { implementQuery, type SliceStoreService } from '@specter-ts/core'
import { Context } from 'effect'
import { z } from 'zod'
import {
  documentSaved,
  messagePosted,
  taskSet,
  viewSet,
  messageChunkAppended,
} from '../events'
import specification from './spec.json' with { type: 'json' }

export type Workspace = {
  documents: Record<
    string,
    { documentId: string; title: string; body: string; revision: number }
  >
  messages: Record<
    string,
    { messageId: string; documentId: string; text: string }
  >
  tasks: Record<
    string,
    {
      taskId: string
      messageId: string
      title: string
      done: boolean
      revision: number
    }
  >
  views: Record<
    string,
    {
      sessionId: string
      documentId: string
      baseRevision: number
      draft: string
      revision: number
    }
  >
}
export const createState = (): Workspace => ({
  documents: {},
  messages: {},
  tasks: {},
  views: {},
})
export const Store = Context.Service<
  SliceStoreService<Workspace, Workspace, unknown>
>('@specter/workspaces/workspace')
export const workspace = implementQuery(specification)
  .inputSchema(z.object({}))
  .outputSchema<Workspace>()
  .store(Store)
  .apply(documentSaved, async ({ payload }, state) => {
    state.documents[payload.documentId] = payload
  })
  .apply(messagePosted, async ({ payload }, state) => {
    state.messages[payload.messageId] = payload
  })
  .apply(taskSet, async ({ payload }, state) => {
    state.tasks[payload.taskId] = payload
  })
  .apply(viewSet, async ({ payload }, state) => {
    state.views[payload.sessionId] = payload
  })
  .apply(messageChunkAppended, async ({ payload }, state) => {
    const message = state.messages[payload.messageId]
    if (!message || message.text.length !== payload.offset)
      throw new Error('Invalid stream history')
    message.text += payload.chunk
  })
  .handle(async (_input, state) => structuredClone(state))
