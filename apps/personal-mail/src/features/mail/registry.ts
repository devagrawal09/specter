import type { CommandRef, QueryRef } from '@specter-ts/core'

import { activityQuery } from './activity-query/impl'
import { analyzeThreadReaction } from './analyze-thread-reaction/impl'
import { applyMailboxActionReaction } from './apply-mailbox-action-reaction/impl'
import { createAutomationRule } from './create-automation-rule/impl'
import { mailEventDefinitions } from './events'
import { inboxQuery } from './inbox-query/impl'
import { recordGmailThread } from './record-gmail-thread/impl'
import { recordGmailThreadRemoved } from './record-gmail-thread-removed/impl'
import { recordMailboxActionResult } from './record-mailbox-action-result/impl'
import { recordThreadAnalysis } from './record-thread-analysis/impl'
import { requestMailboxAction } from './request-mailbox-action/impl'
import { requestThreadAnalysis } from './request-thread-analysis/impl'
import { rulesQuery } from './rules-query/impl'

export const mailRegistrations = {
  recordGmailThread,
  recordGmailThreadRemoved,
  requestThreadAnalysis,
  recordThreadAnalysis,
  createAutomationRule,
  requestMailboxAction,
  recordMailboxActionResult,
  analyzeThreadReaction,
  applyMailboxActionReaction,
  inboxQuery,
  rulesQuery,
  activityQuery,
} as const

export const mailSpecterAppConfig = {
  events: mailEventDefinitions,
  slices: mailRegistrations,
} as const

export type MailSpecterAppConfig = typeof mailSpecterAppConfig
export type InboxQueryRef = QueryRef<typeof inboxQuery>
export type RulesQueryRef = QueryRef<typeof rulesQuery>
export type ActivityQueryRef = QueryRef<typeof activityQuery>
export type RequestThreadAnalysisRef = CommandRef<typeof requestThreadAnalysis>
export type CreateAutomationRuleRef = CommandRef<typeof createAutomationRule>
export type RequestMailboxActionRef = CommandRef<typeof requestMailboxAction>
