import { SessionEvent } from '@ocpp/schema/session-event'
import { implementCommand, type SliceStoreService } from '@specter-ts/core'
import { Context, Schema } from 'effect'

import { sessionEvent } from '../../../events.ts'
import specification from './spec.json' with { type: 'json' }

// Rebuildable projection: Sessions the runtime already knows.
export type RegisterSessionState = {
  sessions: Record<string, true>
}

export const registerSessionStore = Context.Service<
  SliceStoreService<RegisterSessionState, RegisterSessionState, unknown>
>('@specter/agent-runtime/RegisterSessionStore')

export const createRegisterSessionState = (): RegisterSessionState => ({
  sessions: {},
})

const sessionCreated = sessionEvent('session-created')

// The input is the host's session.created payload, decoded by OC++'s schema.
const input = Schema.toStandardSchemaV1(SessionEvent.Created.data)

export const registerSession = implementCommand(specification)
  .inputSchema(input)
  .store(registerSessionStore)
  .apply(sessionCreated, async (event, state) => {
    state.sessions[event.payload.sessionID] = true
  })
  .handle(async (command, state) => {
    if (state.sessions[command.sessionID])
      throw new Error('Session already registered')
    return [sessionCreated.create(command)]
  })
