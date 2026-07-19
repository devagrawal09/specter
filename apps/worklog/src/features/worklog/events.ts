import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

const isoDateTime = z.string().datetime({ offset: true })

export const journalEntryAddedEvent = createEventDefinition(
  'journal-entry-added',
  z
    .object({
      journalEntryId: z.string().min(1),
      body: z.string(),
      activityAt: isoDateTime,
      createdAt: isoDateTime,
    })
    .strict(),
)

export const journalEntryEditedEvent = createEventDefinition(
  'journal-entry-edited',
  z
    .object({
      journalEntryId: z.string().min(1),
      body: z.string(),
      activityAt: isoDateTime,
      editedAt: isoDateTime,
    })
    .strict(),
)

export const journalEntryArchiveChangedEvent = createEventDefinition(
  'journal-entry-archive-changed',
  z
    .object({
      journalEntryId: z.string().min(1),
      archived: z.boolean(),
      changedAt: isoDateTime,
    })
    .strict(),
)

export const taskAddedEvent = createEventDefinition(
  'task-added',
  z
    .object({
      taskId: z.string().min(1),
      title: z.string(),
      notes: z.string().nullable(),
      dueAt: isoDateTime.nullable(),
      createdAt: isoDateTime,
    })
    .strict(),
)

export const taskEditedEvent = createEventDefinition(
  'task-edited',
  z
    .object({
      taskId: z.string().min(1),
      title: z.string(),
      notes: z.string().nullable(),
      dueAt: isoDateTime.nullable(),
      editedAt: isoDateTime,
    })
    .strict(),
)

export const taskCompletionChangedEvent = createEventDefinition(
  'task-completion-changed',
  z
    .object({
      taskId: z.string().min(1),
      completed: z.boolean(),
      changedAt: isoDateTime,
    })
    .strict(),
)

export const taskArchiveChangedEvent = createEventDefinition(
  'task-archive-changed',
  z
    .object({
      taskId: z.string().min(1),
      archived: z.boolean(),
      changedAt: isoDateTime,
    })
    .strict(),
)

export const topicAddedEvent = createEventDefinition(
  'topic-added',
  z
    .object({
      topicId: z.string().min(1),
      name: z.string(),
      description: z.string().nullable(),
      createdAt: isoDateTime,
    })
    .strict(),
)

export const topicEditedEvent = createEventDefinition(
  'topic-edited',
  z
    .object({
      topicId: z.string().min(1),
      name: z.string(),
      description: z.string().nullable(),
      editedAt: isoDateTime,
    })
    .strict(),
)

export const topicArchiveChangedEvent = createEventDefinition(
  'topic-archive-changed',
  z
    .object({
      topicId: z.string().min(1),
      archived: z.boolean(),
      changedAt: isoDateTime,
    })
    .strict(),
)

export const recordsConnectedEvent = createEventDefinition(
  'records-connected',
  z
    .object({
      connectionId: z.string().min(1),
      left: z
        .object({
          kind: z.enum(['journal', 'task', 'topic']),
          id: z.string().min(1),
        })
        .strict(),
      right: z
        .object({
          kind: z.enum(['journal', 'task', 'topic']),
          id: z.string().min(1),
        })
        .strict(),
      connectedAt: isoDateTime,
    })
    .strict(),
)

export const connectionArchiveChangedEvent = createEventDefinition(
  'connection-archive-changed',
  z
    .object({
      connectionId: z.string().min(1),
      archived: z.boolean(),
      changedAt: isoDateTime,
    })
    .strict(),
)

export const pointAwardedEvent = createEventDefinition(
  'point-awarded',
  z
    .object({
      awardKey: z.string().min(1),
      reason: z.enum([
        'journal-added',
        'task-added',
        'topic-added',
        'connection-added',
        'task-first-completed',
        'completed-task-connection',
        'topic-all-tasks-completed',
      ]),
      points: z.literal(1),
      subject: z
        .object({
          kind: z.enum(['journal', 'task', 'topic', 'connection']),
          id: z.string().min(1),
        })
        .strict(),
      related: z.array(
        z
          .object({
            kind: z.enum(['journal', 'task', 'topic']),
            id: z.string().min(1),
          })
          .strict(),
      ),
      awardedAt: isoDateTime,
    })
    .strict(),
)

export const worklogEventDefinitions = [
  journalEntryAddedEvent,
  journalEntryEditedEvent,
  journalEntryArchiveChangedEvent,
  taskAddedEvent,
  taskEditedEvent,
  taskCompletionChangedEvent,
  taskArchiveChangedEvent,
  topicAddedEvent,
  topicEditedEvent,
  topicArchiveChangedEvent,
  recordsConnectedEvent,
  connectionArchiveChangedEvent,
  pointAwardedEvent,
] as const
