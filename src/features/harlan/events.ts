import z from 'zod'
import { createEventSpec } from '../../lib'

const sessionPath = z.string().min(1)
const agentContextId = z.string().min(1)
const scriptExecutionId = z.string().min(1)
const executionContextId = z.string().min(1)
const statementId = z.string().min(1)
const approvalId = z.string().min(1)
const contextSnapshot = z.record(z.string(), z.unknown())
const optionalMessage = z.string().optional()

const sessionEventPayload = z.object({
  sessionPath,
})

const agentContextPayload = sessionEventPayload.extend({
  agentContextId,
})

const scriptExecutionPayload = agentContextPayload.extend({
  scriptExecutionId,
})

const executionContextPayload = scriptExecutionPayload.extend({
  executionContextId,
})

const statementEvaluationPayload = executionContextPayload.extend({
  statementId,
})

export const harlanSessionStartedEvent = createEventSpec(
  'harlanSessionStarted',
  sessionEventPayload.extend({
    title: z.string().min(1).optional(),
  }),
)

export const harlanInitScriptExecutionStartedEvent = createEventSpec(
  'harlanInitScriptExecutionStarted',
  sessionEventPayload.extend({
    scriptExecutionId,
    code: z.string(),
  }),
)

export const harlanInitScriptExecutionCompletedEvent = createEventSpec(
  'harlanInitScriptExecutionCompleted',
  sessionEventPayload.extend({
    scriptExecutionId,
    result: z.unknown().optional(),
  }),
)

export const harlanUserMessagedEvent = createEventSpec(
  'harlanUserMessaged',
  sessionEventPayload.extend({
    message: z.string(),
  }),
)

export const harlanAgentContextCreatedEvent = createEventSpec(
  'harlanAgentContextCreated',
  agentContextPayload.extend({
    model: z.string().min(1).optional(),
    context: contextSnapshot.optional(),
  }),
)

export const harlanAgentStartedThinkingEvent = createEventSpec(
  'harlanAgentStartedThinking',
  agentContextPayload.extend({
    prompt: optionalMessage,
  }),
)

export const harlanAgentFinishedThinkingEvent = createEventSpec(
  'harlanAgentFinishedThinking',
  agentContextPayload.extend({
    thought: optionalMessage,
  }),
)

export const harlanAgentStartedScriptingEvent = createEventSpec(
  'harlanAgentStartedScripting',
  agentContextPayload,
)

export const harlanAgentFinishedScriptingEvent = createEventSpec(
  'harlanAgentFinishedScripting',
  agentContextPayload.extend({
    code: z.string(),
  }),
)

export const harlanScriptExecutionStartedEvent = createEventSpec(
  'harlanScriptExecutionStarted',
  scriptExecutionPayload.extend({
    code: z.string(),
  }),
)

export const harlanScriptExecutionCompletedEvent = createEventSpec(
  'harlanScriptExecutionCompleted',
  scriptExecutionPayload.extend({
    result: z.unknown().optional(),
  }),
)

export const harlanScriptExecutionErrorEvent = createEventSpec(
  'harlanScriptExecutionError',
  scriptExecutionPayload.extend({
    error: z.string(),
  }),
)

export const harlanScriptExecutionSuspendedEvent = createEventSpec(
  'harlanScriptExecutionSuspended',
  scriptExecutionPayload.extend({
    reason: optionalMessage,
  }),
)

export const harlanScriptExecutionResumedEvent = createEventSpec(
  'harlanScriptExecutionResumed',
  scriptExecutionPayload,
)

export const harlanAgentStartedRespondingEvent = createEventSpec(
  'harlanAgentStartedResponding',
  agentContextPayload,
)

export const harlanAgentFinishedRespondingEvent = createEventSpec(
  'harlanAgentFinishedResponding',
  agentContextPayload.extend({
    response: z.string(),
  }),
)

export const harlanAgentContextSavedEvent = createEventSpec(
  'harlanAgentContextSaved',
  agentContextPayload.extend({
    context: contextSnapshot,
  }),
)

export const harlanStdlibUpdatedEvent = createEventSpec(
  'harlanStdlibUpdated',
  sessionEventPayload.extend({
    version: z.string().min(1).optional(),
    modules: z.array(z.string().min(1)).optional(),
  }),
)

export const harlanExecutionContextCreatedEvent = createEventSpec(
  'harlanExecutionContextCreated',
  executionContextPayload.extend({
    context: contextSnapshot.optional(),
  }),
)

export const harlanStatementEvaluationStartedEvent = createEventSpec(
  'harlanStatementEvaluationStarted',
  statementEvaluationPayload.extend({
    statement: z.string(),
  }),
)

export const harlanBindingAddedToContextEvent = createEventSpec(
  'harlanBindingAddedToContext',
  statementEvaluationPayload.extend({
    bindingName: z.string().min(1),
    value: z.unknown().optional(),
  }),
)

export const harlanStatementEvaluationCompletedEvent = createEventSpec(
  'harlanStatementEvaluationCompleted',
  statementEvaluationPayload.extend({
    result: z.unknown().optional(),
  }),
)

export const harlanExecutionSuspendedEvent = createEventSpec(
  'harlanExecutionSuspended',
  executionContextPayload.extend({
    reason: optionalMessage,
  }),
)

export const harlanExecutionContextSavedEvent = createEventSpec(
  'harlanExecutionContextSaved',
  executionContextPayload.extend({
    context: contextSnapshot,
  }),
)

export const harlanExecutionContextRestoredEvent = createEventSpec(
  'harlanExecutionContextRestored',
  executionContextPayload.extend({
    context: contextSnapshot,
  }),
)

export const harlanUserApprovalRequiredEvent = createEventSpec(
  'harlanUserApprovalRequired',
  executionContextPayload.extend({
    approvalId,
    reason: optionalMessage,
  }),
)

export const harlanUserApprovalGrantedEvent = createEventSpec(
  'harlanUserApprovalGranted',
  executionContextPayload.extend({
    approvalId,
  }),
)

export type HarlanEvent =
  | ReturnType<typeof harlanSessionStartedEvent.create>
  | ReturnType<typeof harlanInitScriptExecutionStartedEvent.create>
  | ReturnType<typeof harlanInitScriptExecutionCompletedEvent.create>
  | ReturnType<typeof harlanUserMessagedEvent.create>
  | ReturnType<typeof harlanAgentContextCreatedEvent.create>
  | ReturnType<typeof harlanAgentStartedThinkingEvent.create>
  | ReturnType<typeof harlanAgentFinishedThinkingEvent.create>
  | ReturnType<typeof harlanAgentStartedScriptingEvent.create>
  | ReturnType<typeof harlanAgentFinishedScriptingEvent.create>
  | ReturnType<typeof harlanScriptExecutionStartedEvent.create>
  | ReturnType<typeof harlanScriptExecutionCompletedEvent.create>
  | ReturnType<typeof harlanScriptExecutionErrorEvent.create>
  | ReturnType<typeof harlanScriptExecutionSuspendedEvent.create>
  | ReturnType<typeof harlanScriptExecutionResumedEvent.create>
  | ReturnType<typeof harlanAgentStartedRespondingEvent.create>
  | ReturnType<typeof harlanAgentFinishedRespondingEvent.create>
  | ReturnType<typeof harlanAgentContextSavedEvent.create>
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
