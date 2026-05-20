import z from 'zod'
import { createCommandSpec } from '../../../../lib_legacy/registry.builders'
import { harlanScriptExecutionStartedEvent } from '../events'

export const executeHarlanScript = createCommandSpec('executeHarlanScript')
  .schema(
    z.object({
      sessionPath: z.string().min(1),
      agentContextId: z.string().min(1),
      scriptExecutionId: z.string().min(1),
      code: z.string(),
    }),
  )
  .scenarios({
    given: [],
    when: {
      sessionPath: 'session-1',
      agentContextId: 'agent-1',
      scriptExecutionId: 'script-1',
      code: '"hello"',
    },
    expect: [
      harlanScriptExecutionStartedEvent.create({
        sessionPath: 'session-1',
        agentContextId: 'agent-1',
        scriptExecutionId: 'script-1',
        code: '"hello"',
      }),
    ],
  })
  .decide((command) => [harlanScriptExecutionStartedEvent.create(command)])
