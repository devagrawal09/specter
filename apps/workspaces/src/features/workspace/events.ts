import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

export const documentSaved = createEventDefinition(
  'document-saved',
  z.object({
    documentId: z.string(),
    title: z.string(),
    body: z.string(),
    revision: z.number().int(),
  }),
)
export const messagePosted = createEventDefinition(
  'message-posted',
  z.object({ messageId: z.string(), documentId: z.string(), text: z.string() }),
)
export const taskSet = createEventDefinition(
  'task-set',
  z.object({
    taskId: z.string(),
    messageId: z.string(),
    title: z.string(),
    done: z.boolean(),
    revision: z.number().int(),
  }),
)
export const viewSet = createEventDefinition(
  'view-set',
  z.object({
    sessionId: z.string(),
    documentId: z.string(),
    draft: z.string(),
    baseRevision: z.number().int(),
    revision: z.number().int(),
  }),
)
export const messageChunkAppended = createEventDefinition(
  'message-chunk-appended',
  z.object({
    messageId: z.string(),
    offset: z.number().int(),
    chunk: z.string(),
  }),
)
export const events = [
  documentSaved,
  messagePosted,
  taskSet,
  viewSet,
  messageChunkAppended,
] as const
