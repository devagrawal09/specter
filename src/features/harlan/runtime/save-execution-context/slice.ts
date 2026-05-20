import z from 'zod'
import { createCommandSpec } from '../../../../lib_legacy/registry.builders'
import { harlanExecutionContextSavedEvent } from '../events'

export const saveHarlanExecutionContext = createCommandSpec(
  'saveHarlanExecutionContext',
)
  .schema(
    z.object({
      sessionPath: z.string().min(1),
      agentContextId: z.string().min(1),
      scriptExecutionId: z.string().min(1),
      executionContextId: z.string().min(1),
      context: z.record(z.string(), z.unknown()),
    }),
  )
  .scenarios({
    given: [],
    when: {
      sessionPath: 'session-1',
      agentContextId: 'agent-1',
      scriptExecutionId: 'script-1',
      executionContextId: 'script-1',
      context: {
        bindings: {},
        importedModules: [],
      },
    },
    expect: [
      harlanExecutionContextSavedEvent.create({
        sessionPath: 'session-1',
        agentContextId: 'agent-1',
        scriptExecutionId: 'script-1',
        executionContextId: 'script-1',
        context: {
          bindings: {},
          importedModules: [],
        },
      }),
    ],
  })
  .decide((command) => [harlanExecutionContextSavedEvent.create(command)])
