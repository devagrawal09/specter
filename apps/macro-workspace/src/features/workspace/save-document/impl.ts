import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context } from 'effect'
import { z } from 'zod'
import { documentSaved } from '../events'
import specification from './spec.json' with { type: 'json' }

type State = { revisions: Record<string, number> }
export const createState = (): State => ({ revisions: {} })
export const Store = Context.Service<SliceStoreService<State, State, unknown>>(
  '@macro/saveDocument',
)
export const saveDocument = implementCommand(specification)
  .inputSchema(
    z.object({
      documentId: z.string().regex(/^[a-z]+-[a-z0-9-]+$/),
      title: z.string().min(1),
      body: z.string(),
      expectedRevision: z.number().int().nonnegative(),
    }),
  )
  .store(Store)
  .apply(documentSaved, async ({ payload }, state) => {
    state.revisions[payload.documentId] = payload.revision
  })
  .handle(async (input, state) => {
    const revision = state.revisions[input.documentId] ?? 0
    if (revision !== input.expectedRevision)
      throw new Error('Document revision conflict')
    return [
      documentSaved.create({
        documentId: input.documentId,
        title: input.title,
        body: input.body,
        revision: revision + 1,
      }),
    ]
  })
