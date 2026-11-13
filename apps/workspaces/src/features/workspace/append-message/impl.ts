import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context } from 'effect'
import { z } from 'zod'
import { messagePosted, messageChunkAppended } from '../events'
import specification from './spec.json' with { type: 'json' }

type State = { lengths: Record<string, number> }
export const createState = (): State => ({ lengths: {} })
export const Store = Context.Service<SliceStoreService<State, State, unknown>>(
  '@specter/workspaces/appendMessage',
)
export const appendMessage = implementCommand(specification)
  .inputSchema(
    z.object({
      messageId: z.string().regex(/^[a-z]+-[a-z0-9-]+$/),
      offset: z.number().int().nonnegative(),
      chunk: z.string().min(1),
    }),
  )
  .store(Store)
  .apply(messagePosted, async ({ payload }, state) => {
    state.lengths[payload.messageId] = payload.text.length
  })
  .apply(messageChunkAppended, async ({ payload }, state) => {
    state.lengths[payload.messageId] = payload.offset + payload.chunk.length
  })
  .handle(async (input, state) => {
    const length = state.lengths[input.messageId]
    if (length === undefined) throw new Error('Message not found')
    if (length !== input.offset) throw new Error('Message offset conflict')
    return [messageChunkAppended.create(input)]
  })
