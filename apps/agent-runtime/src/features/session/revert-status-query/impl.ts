import { SessionID } from '@ocpp/schema/session-id'
import { implementQuery, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection: the staged Revert per Session, exactly as staged.
type Revert = { messageID: string }

export type RevertStatusState = { staged: Record<string, Revert> }

export const revertStatusStore = Context.Service<
  SliceStoreService<RevertStatusState, RevertStatusState, unknown>
>('@specter/agent-runtime/RevertStatusStore')

export const createRevertStatusState = (): RevertStatusState => ({
  staged: {},
})

const revertStaged = sessionEvent('session-revert-staged')
const revertCleared = sessionEvent('session-revert-cleared')
const revertCommitted = sessionEvent('session-revert-committed')

const input = Schema.toStandardSchemaV1(Schema.Struct({ sessionID: SessionID }))

export const revertStatus = implementQuery(specification)
  .inputSchema(input)
  .outputSchema<{ staged: Revert | null }>()
  .store(revertStatusStore)
  .apply(revertStaged, async (event, state) => {
    state.staged[event.payload.sessionID] = {
      messageID: event.payload.revert.messageID,
    }
  })
  .apply(revertCleared, async (event, state) => {
    delete state.staged[event.payload.sessionID]
  })
  .apply(revertCommitted, async (event, state) => {
    delete state.staged[event.payload.sessionID]
  })
  .handle(async (query, state) => ({
    staged: state.staged[query.sessionID] ?? null,
  }))
