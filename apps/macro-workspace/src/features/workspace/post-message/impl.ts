import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context } from 'effect'
import { z } from 'zod'
import { documentSaved, messagePosted } from '../events'
import specification from './spec.json' with { type: 'json' }

type State = {
  documents: Record<string, boolean>
  messages: Record<string, boolean>
}
export const createState = (): State => ({ documents: {}, messages: {} })
export const Store =
  Context.Service<SliceStoreService<State, State, unknown>>(
    '@macro/postMessage',
  )
export const postMessage = implementCommand(specification)
  .inputSchema(
    z.object({
      messageId: z.string().regex(/^[a-z]+-[a-z0-9-]+$/),
      documentId: z.string().regex(/^[a-z]+-[a-z0-9-]+$/),
      text: z.string(),
    }),
  )
  .store(Store)
  .apply(documentSaved, async ({ payload }, state) => {
    state.documents[payload.documentId] = true
  })
  .apply(messagePosted, async ({ payload }, state) => {
    state.messages[payload.messageId] = true
  })
  .handle(async (input, state) => {
    if (!state.documents[input.documentId])
      throw new Error('Document not found')
    if (state.messages[input.messageId])
      throw new Error('Message already exists')
    return [messagePosted.create(input)]
  })
