import { createReactionSpec } from '../../../../lib/registry.builders'
import { harlanScriptExecutionCompletedEvent } from '../events'

export const saveHarlanExecutionContextAfterCompletion = createReactionSpec(
  'saveHarlanExecutionContextAfterCompletion',
  { json: true },
)
  .scenarios({
    given: [],
    when: harlanScriptExecutionCompletedEvent.create({
      sessionPath: 'session-1',
      agentContextId: 'agent-1',
      scriptExecutionId: 'script-1',
      result: {
        rendered: 'hello',
        value: 'hello',
        output: [],
        warnings: [],
        sessionSnapshot: {
          bindings: {},
          importedModules: [],
        },
      },
    }),
    expect: [
      {
        type: 'saveHarlanExecutionContext',
        payload: {
          sessionPath: 'session-1',
          agentContextId: 'agent-1',
          scriptExecutionId: 'script-1',
          executionContextId: 'script-1',
          context: {
            bindings: {},
            importedModules: [],
          },
        },
      },
    ],
  })
  .apply({
    [harlanScriptExecutionCompletedEvent.type]: (event, store) => {
      store.set('command', {
        type: 'saveHarlanExecutionContext',
        payload: {
          sessionPath: event.payload.sessionPath,
          agentContextId: event.payload.agentContextId,
          scriptExecutionId: event.payload.scriptExecutionId,
          executionContextId: event.payload.scriptExecutionId,
          context: event.payload.result.sessionSnapshot,
        },
      })
    },
  })
  .react((store) => {
    const command = store.get<{
      type: 'saveHarlanExecutionContext'
      payload: {
        sessionPath: string
        agentContextId: string
        scriptExecutionId: string
        executionContextId: string
        context: {
          bindings: Record<string, unknown>
          importedModules: string[]
          initialized?: boolean
        }
      }
    }>('command')

    return command ? [command] : []
  })
