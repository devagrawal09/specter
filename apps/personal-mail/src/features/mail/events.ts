import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

export const mailboxActionSchema = z.enum(['archive', 'markRead', 'star'])
export const analysisProviderSchema = z.enum(['local', 'cloud'])

export const gmailThreadRecordedEvent = createEventDefinition(
  'gmail-thread-recorded',
  z.object({
    threadId: z.string().min(1),
    messageId: z.string().min(1),
    historyId: z.string().min(1),
    sender: z.string(),
    subject: z.string(),
    snippet: z.string(),
    bodyText: z.string(),
    receivedAt: z.string().min(1),
    unread: z.boolean(),
    labels: z.array(z.string()),
  }),
)

export const threadAnalysisRequestedEvent = createEventDefinition(
  'thread-analysis-requested',
  z.object({
    analysisId: z.string().min(1),
    threadId: z.string().min(1),
    provider: analysisProviderSchema,
    requestedAt: z.string().min(1),
  }),
)

export const threadAnalyzedEvent = createEventDefinition(
  'thread-analyzed',
  z.object({
    analysisId: z.string().min(1),
    threadId: z.string().min(1),
    provider: analysisProviderSchema,
    summary: z.string().min(1),
    priority: z.enum(['low', 'normal', 'high']),
    suggestedAction: z.enum(['none', 'archive', 'markRead', 'star', 'reply']),
    analyzedAt: z.string().min(1),
  }),
)

export const automationRuleCreatedEvent = createEventDefinition(
  'automation-rule-created',
  z.object({
    ruleId: z.string().min(1),
    name: z.string().min(1),
    senderContains: z.string(),
    subjectContains: z.string(),
    action: mailboxActionSchema,
    enabled: z.boolean(),
    createdAt: z.string().min(1),
  }),
)

export const mailboxActionRequestedEvent = createEventDefinition(
  'mailbox-action-requested',
  z.object({
    actionId: z.string().min(1),
    threadId: z.string().min(1),
    action: mailboxActionSchema,
    source: z.enum(['manual', 'automation']),
    authorizedByRuleId: z.string().nullable(),
    requestedAt: z.string().min(1),
  }),
)

export const mailboxActionAppliedEvent = createEventDefinition(
  'mailbox-action-applied',
  z.object({
    actionId: z.string().min(1),
    threadId: z.string().min(1),
    action: mailboxActionSchema,
    gmailHistoryId: z.string().min(1),
    appliedAt: z.string().min(1),
  }),
)

export const mailboxActionFailedEvent = createEventDefinition(
  'mailbox-action-failed',
  z.object({
    actionId: z.string().min(1),
    threadId: z.string().min(1),
    action: mailboxActionSchema,
    reason: z.string().min(1),
    failedAt: z.string().min(1),
  }),
)

export const mailboxActionReconciliationNeededEvent = createEventDefinition(
  'mailbox-action-reconciliation-needed',
  z.object({
    actionId: z.string().min(1),
    threadId: z.string().min(1),
    action: mailboxActionSchema,
    reason: z.string().min(1),
    detectedAt: z.string().min(1),
  }),
)

export const mailEventDefinitions = [
  gmailThreadRecordedEvent,
  threadAnalysisRequestedEvent,
  threadAnalyzedEvent,
  automationRuleCreatedEvent,
  mailboxActionRequestedEvent,
  mailboxActionAppliedEvent,
  mailboxActionFailedEvent,
  mailboxActionReconciliationNeededEvent,
] as const
