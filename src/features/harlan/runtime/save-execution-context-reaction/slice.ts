import { createReactionSpec } from '../../../../lib/registry.builders'
import { harlanScriptExecutionCompletedEvent } from '../events'

export const saveHarlanExecutionContextAfterCompletion = createReactionSpec(
  'saveHarlanExecutionContextAfterCompletion',
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
  .react((event) => {
    if (!harlanScriptExecutionCompletedEvent.is(event)) {
      return []
    }

    return [
      {
        type: 'saveHarlanExecutionContext',
        payload: {
          sessionPath: event.payload.sessionPath,
          agentContextId: event.payload.agentContextId,
          scriptExecutionId: event.payload.scriptExecutionId,
          executionContextId: event.payload.scriptExecutionId,
          context: event.payload.result.sessionSnapshot,
        },
      },
    ]
  })
