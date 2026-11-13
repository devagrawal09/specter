import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context } from 'effect'
import { z } from 'zod'
import { documentSaved, viewSet } from '../events'
import specification from './spec.json' with { type: 'json' }

type State = {
  documents: Record<string, boolean>
  revisions: Record<string, number>
}
export const createState = (): State => ({ documents: {}, revisions: {} })
export const Store = Context.Service<SliceStoreService<State, State, unknown>>(
  '@specter/workspaces/setView',
)
export const setView = implementCommand(specification)
  .inputSchema(
    z.object({
      sessionId: z.string().regex(/^[a-z]+-[a-z0-9-]+$/),
      documentId: z.string().regex(/^[a-z]+-[a-z0-9-]+$/),
      draft: z.string(),
      baseRevision: z.number().int().nonnegative(),
      expectedRevision: z.number().int().nonnegative(),
    }),
  )
  .store(Store)
  .apply(documentSaved, async ({ payload }, state) => {
    state.documents[payload.documentId] = true
  })
  .apply(viewSet, async ({ payload }, state) => {
    state.revisions[payload.sessionId] = payload.revision
  })
  .handle(async (input, state) => {
    if (!state.documents[input.documentId])
      throw new Error('Document not found')
    const revision = state.revisions[input.sessionId] ?? 0
    if (revision !== input.expectedRevision)
      throw new Error('View revision conflict')
    return [
      viewSet.create({
        sessionId: input.sessionId,
        documentId: input.documentId,
        draft: input.draft,
        baseRevision: input.baseRevision,
        revision: revision + 1,
      }),
    ]
  })
