import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context } from 'effect'
import { z } from 'zod'
import { messagePosted, taskSet } from '../events'
import specification from './spec.json' with { type: 'json' }

type State = {
  messages: Record<string, boolean>
  revisions: Record<string, number>
}
export const createState = (): State => ({ messages: {}, revisions: {} })
export const Store =
  Context.Service<SliceStoreService<State, State, unknown>>('@macro/setTask')
export const setTask = implementCommand(specification)
  .inputSchema(
    z.object({
      taskId: z.string().regex(/^[a-z]+-[a-z0-9-]+$/),
      messageId: z.string().regex(/^[a-z]+-[a-z0-9-]+$/),
      title: z.string().min(1),
      done: z.boolean(),
      expectedRevision: z.number().int().nonnegative(),
    }),
  )
  .store(Store)
  .apply(messagePosted, async ({ payload }, state) => {
    state.messages[payload.messageId] = true
  })
  .apply(taskSet, async ({ payload }, state) => {
    state.revisions[payload.taskId] = payload.revision
  })
  .handle(async (input, state) => {
    if (!state.messages[input.messageId]) throw new Error('Message not found')
    const revision = state.revisions[input.taskId] ?? 0
    if (revision !== input.expectedRevision)
      throw new Error('Task revision conflict')
    return [
      taskSet.create({
        taskId: input.taskId,
        messageId: input.messageId,
        title: input.title,
        done: input.done,
        revision: revision + 1,
      }),
    ]
  })
