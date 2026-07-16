import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

export const operatorWorkflowPreviewedEvent = createEventDefinition(
  'operator-workflow-previewed',
  z.object({
    workflowId: z.string(),
    kind: z.enum([
      'repo_recon',
      'opportunity_analysis',
      'project_plan',
      'demo_script',
      'scoped_implementation',
      'review_verification',
    ]),
    promptPreview: z.string(),
  }),
)

export const operatorWorkflowRunConfirmedEvent = createEventDefinition(
  'operator-workflow-run-confirmed',
  z.object({
    workflowId: z.string(),
    confirmedBy: z.string(),
    confirmedAt: z.string(),
  }),
)

export const opencodeFollowupRequestedEvent = createEventDefinition(
  'opencode-followup-requested',
  z.object({
    runId: z.string(),
    message: z.string(),
    requestedAt: z.string(),
  }),
)

export const opencodeRunCancelRequestedEvent = createEventDefinition(
  'opencode-run-cancel-requested',
  z.object({
    runId: z.string(),
    reason: z.string(),
    requestedAt: z.string(),
  }),
)

export const operatorWorkflowEventDefinitions = [
  operatorWorkflowPreviewedEvent,
  operatorWorkflowRunConfirmedEvent,
  opencodeFollowupRequestedEvent,
  opencodeRunCancelRequestedEvent,
] as const
