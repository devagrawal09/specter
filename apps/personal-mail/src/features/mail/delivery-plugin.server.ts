import type { AnalyzeThreadOutput } from './analyze-thread-reaction/impl'
import type { ApplyMailboxActionOutput } from './apply-mailbox-action-reaction/impl'

export type MailDeliveryOutput = AnalyzeThreadOutput | ApplyMailboxActionOutput
