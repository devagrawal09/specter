import { z } from 'zod'

export const inboundOpenCodeEventNames = [
  'opencode.run.started',
  'opencode.run.status_changed',
  'opencode.log.appended',
  'opencode.tool.completed',
  'opencode.file.changed',
  'opencode.suggestion.created',
  'opencode.run.completed',
  'opencode.run.failed',
] as const

export const outboundOpenCodeOperationNames = [
  'opencode.connection.health_check',
  'opencode.run.start',
  'opencode.run.cancel',
  'opencode.run.send_input',
] as const

export const linkedEntitySchema = z.object({
  type: z.enum(['opportunity', 'project', 'task', 'demo']),
  id: z.string(),
})

export const openCodeCommandEnvelopeSchema = z.object({
  commandId: z.string(),
  operation: z.enum(outboundOpenCodeOperationNames),
  issuedAt: z.string(),
  runId: z.string().optional(),
  clientRunId: z.string().optional(),
  linkedEntity: linkedEntitySchema.optional(),
  payload: z.record(z.string(), z.unknown()),
})

export type InboundOpenCodeEventName = (typeof inboundOpenCodeEventNames)[number]
export type OutboundOpenCodeOperationName =
  (typeof outboundOpenCodeOperationNames)[number]
export type LinkedEntity = z.infer<typeof linkedEntitySchema>
export type OpenCodeCommandEnvelope = z.infer<
  typeof openCodeCommandEnvelopeSchema
>
