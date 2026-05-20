import z from 'zod'
import { createEventSpec } from '../../../lib_legacy'

export const harlanInitScriptExecutionStartedEvent = createEventSpec(
  'harlanInitScriptExecutionStarted',
  z.object({
    sessionPath: z.string().min(1),
    scriptExecutionId: z.string().min(1),
    code: z.string(),
  }),
)

export const harlanInitScriptExecutionCompletedEvent = createEventSpec(
  'harlanInitScriptExecutionCompleted',
  z.object({
    sessionPath: z.string().min(1),
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

export const harlanScriptExecutionStartedEvent = createEventSpec(
  'harlanScriptExecutionStarted',
  z.object({
    sessionPath: z.string().min(1),
    agentContextId: z.string().min(1),
    scriptExecutionId: z.string().min(1),
    code: z.string(),
  }),
)

export const harlanScriptExecutionCompletedEvent = createEventSpec(
  'harlanScriptExecutionCompleted',
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

export const harlanScriptExecutionErrorEvent = createEventSpec(
  'harlanScriptExecutionError',
  z.object({
    sessionPath: z.string().min(1),
    agentContextId: z.string().min(1),
    scriptExecutionId: z.string().min(1),
    error: z.string(),
  }),
)

export const harlanScriptExecutionSuspendedEvent = createEventSpec(
  'harlanScriptExecutionSuspended',
  z.object({
    sessionPath: z.string().min(1),
    agentContextId: z.string().min(1),
    scriptExecutionId: z.string().min(1),
    reason: z.string().optional(),
  }),
)

export const harlanScriptExecutionResumedEvent = createEventSpec(
  'harlanScriptExecutionResumed',
  z.object({
    sessionPath: z.string().min(1),
    agentContextId: z.string().min(1),
    scriptExecutionId: z.string().min(1),
  }),
)

export const harlanStdlibUpdatedEvent = createEventSpec(
  'harlanStdlibUpdated',
  z.object({
    sessionPath: z.string().min(1),
    version: z.string().min(1).optional(),
    modules: z.array(z.string().min(1)).optional(),
  }),
)

export const harlanExecutionContextCreatedEvent = createEventSpec(
  'harlanExecutionContextCreated',
  z.object({
    sessionPath: z.string().min(1),
    agentContextId: z.string().min(1),
    scriptExecutionId: z.string().min(1),
    executionContextId: z.string().min(1),
    context: z.record(z.string(), z.unknown()).optional(),
  }),
)

export const harlanStatementEvaluationStartedEvent = createEventSpec(
  'harlanStatementEvaluationStarted',
  z.object({
    sessionPath: z.string().min(1),
    agentContextId: z.string().min(1),
    scriptExecutionId: z.string().min(1),
    executionContextId: z.string().min(1),
    statementId: z.string().min(1),
    statement: z.string(),
  }),
)

export const harlanBindingAddedToContextEvent = createEventSpec(
  'harlanBindingAddedToContext',
  z.object({
    sessionPath: z.string().min(1),
    agentContextId: z.string().min(1),
    scriptExecutionId: z.string().min(1),
    executionContextId: z.string().min(1),
    statementId: z.string().min(1),
    bindingName: z.string().min(1),
    value: z.unknown().optional(),
  }),
)

export const harlanStatementEvaluationCompletedEvent = createEventSpec(
  'harlanStatementEvaluationCompleted',
  z.object({
    sessionPath: z.string().min(1),
    agentContextId: z.string().min(1),
    scriptExecutionId: z.string().min(1),
    executionContextId: z.string().min(1),
    statementId: z.string().min(1),
    result: z.unknown().optional(),
  }),
)

export const harlanExecutionSuspendedEvent = createEventSpec(
  'harlanExecutionSuspended',
  z.object({
    sessionPath: z.string().min(1),
    agentContextId: z.string().min(1),
    scriptExecutionId: z.string().min(1),
    executionContextId: z.string().min(1),
    reason: z.string().optional(),
  }),
)

export const harlanExecutionContextSavedEvent = createEventSpec(
  'harlanExecutionContextSaved',
  z.object({
    sessionPath: z.string().min(1),
    agentContextId: z.string().min(1),
    scriptExecutionId: z.string().min(1),
    executionContextId: z.string().min(1),
    context: z.record(z.string(), z.unknown()),
  }),
)

export const harlanExecutionContextRestoredEvent = createEventSpec(
  'harlanExecutionContextRestored',
  z.object({
    sessionPath: z.string().min(1),
    agentContextId: z.string().min(1),
    scriptExecutionId: z.string().min(1),
    executionContextId: z.string().min(1),
    context: z.record(z.string(), z.unknown()),
  }),
)

export const harlanUserApprovalRequiredEvent = createEventSpec(
  'harlanUserApprovalRequired',
  z.object({
    sessionPath: z.string().min(1),
    agentContextId: z.string().min(1),
    scriptExecutionId: z.string().min(1),
    executionContextId: z.string().min(1),
    approvalId: z.string().min(1),
    reason: z.string().optional(),
  }),
)

export const harlanUserApprovalGrantedEvent = createEventSpec(
  'harlanUserApprovalGranted',
  z.object({
    sessionPath: z.string().min(1),
    agentContextId: z.string().min(1),
    scriptExecutionId: z.string().min(1),
    executionContextId: z.string().min(1),
    approvalId: z.string().min(1),
  }),
)

export type HarlanRuntimeEvent =
  | ReturnType<typeof harlanInitScriptExecutionStartedEvent.create>
  | ReturnType<typeof harlanInitScriptExecutionCompletedEvent.create>
  | ReturnType<typeof harlanScriptExecutionStartedEvent.create>
  | ReturnType<typeof harlanScriptExecutionCompletedEvent.create>
  | ReturnType<typeof harlanScriptExecutionErrorEvent.create>
  | ReturnType<typeof harlanScriptExecutionSuspendedEvent.create>
  | ReturnType<typeof harlanScriptExecutionResumedEvent.create>
  | ReturnType<typeof harlanStdlibUpdatedEvent.create>
  | ReturnType<typeof harlanExecutionContextCreatedEvent.create>
  | ReturnType<typeof harlanStatementEvaluationStartedEvent.create>
  | ReturnType<typeof harlanBindingAddedToContextEvent.create>
  | ReturnType<typeof harlanStatementEvaluationCompletedEvent.create>
  | ReturnType<typeof harlanExecutionSuspendedEvent.create>
  | ReturnType<typeof harlanExecutionContextSavedEvent.create>
  | ReturnType<typeof harlanExecutionContextRestoredEvent.create>
  | ReturnType<typeof harlanUserApprovalRequiredEvent.create>
  | ReturnType<typeof harlanUserApprovalGrantedEvent.create>
