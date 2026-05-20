import z from 'zod'
import { createCommandSpec } from '../../../../lib_legacy/registry.builders'
import {
  harlanScriptExecutionCompletedEvent,
  harlanScriptExecutionErrorEvent,
} from '../events'

export const completeHarlanScriptExecution = createCommandSpec(
  'completeHarlanScriptExecution',
)
  .schema(
    z.object({
      sessionPath: z.string().min(1),
      agentContextId: z.string().min(1),
      scriptExecutionId: z.string().min(1),
      result: z.object({
        rendered: z.string(),
        value: z.unknown().optional(),
        output: z.array(z.string()),
        warnings: z.array(z.string()),
        sessionSnapshot: z.object({
          bindings: z.record(z.string(), z.unknown()),
          importedModules: z.array(z.string()),
          initialized: z.boolean().optional(),
        }),
        suppressNullValue: z.boolean().optional(),
      }),
    }),
  )
  .scenarios({
    given: [],
    when: {
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
    },
    expect: [
      harlanScriptExecutionCompletedEvent.create({
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
    ],
  })
  .decide((command) => [harlanScriptExecutionCompletedEvent.create(command)])

export const failHarlanScriptExecution = createCommandSpec(
  'failHarlanScriptExecution',
)
  .schema(
    z.object({
      sessionPath: z.string().min(1),
      agentContextId: z.string().min(1),
      scriptExecutionId: z.string().min(1),
      error: z.string(),
    }),
  )
  .scenarios({
    given: [],
    when: {
      sessionPath: 'session-1',
      agentContextId: 'agent-1',
      scriptExecutionId: 'script-1',
      error: 'RuntimeError: unknown binding `fs`',
    },
    expect: [
      harlanScriptExecutionErrorEvent.create({
        sessionPath: 'session-1',
        agentContextId: 'agent-1',
        scriptExecutionId: 'script-1',
        error: 'RuntimeError: unknown binding `fs`',
      }),
    ],
  })
  .decide((command) => [harlanScriptExecutionErrorEvent.create(command)])
