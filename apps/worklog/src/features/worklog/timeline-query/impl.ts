import { z } from 'zod'

import {
  connectionArchiveChangedEvent,
  journalEntryAddedEvent,
  journalEntryArchiveChangedEvent,
  journalEntryEditedEvent,
  recordsConnectedEvent,
  taskAddedEvent,
  taskArchiveChangedEvent,
  taskCompletionChangedEvent,
  taskEditedEvent,
  topicAddedEvent,
  topicArchiveChangedEvent,
  topicEditedEvent,
} from '../events'
import { createWorklogMemoryStore } from '../memory-store'
import type { EntityRef } from '../model'
import { timelineQuerySpec } from './spec'

type TimelineItem = {
  id: string
  eventType: string
  sourceId: string | null
  activityAt: string
  title: string
  detail: string
  archived: boolean
  subject: EntityRef | null
  sequence: number
}
type State = { items: TimelineItem[]; sequence: number }
const store = createWorklogMemoryStore<State>(() => ({
  items: [],
  sequence: 0,
}))
const publicItem = z
  .object({
    id: z.string(),
    eventType: z.string(),
    activityAt: z.string(),
    title: z.string(),
    detail: z.string(),
    archived: z.boolean(),
    subject: z
      .object({ kind: z.enum(['journal', 'task', 'topic']), id: z.string() })
      .strict()
      .nullable(),
  })
  .strict()

export const timelineQuery = timelineQuerySpec
  .inputSchema(
    z
      .object({
        includeArchived: z.boolean(),
        limit: z.number().int().min(1).max(200),
      })
      .strict(),
  )
  .outputSchema(z.array(publicItem))
  .store(store)
  .apply(journalEntryAddedEvent, async (event, state) => {
    state.items.push(
      item(
        state,
        event.id,
        event.type,
        event.payload.journalEntryId,
        event.payload.activityAt,
        'Journal',
        event.payload.body,
        { kind: 'journal', id: event.payload.journalEntryId },
      ),
    )
  })
  .apply(journalEntryEditedEvent, async (event, state) => {
    updateSubject(
      state,
      { kind: 'journal', id: event.payload.journalEntryId },
      (value) => {
        value.detail = event.payload.body
        value.activityAt = event.payload.activityAt
      },
    )
  })
  .apply(journalEntryArchiveChangedEvent, async (event, state) => {
    updateSubject(
      state,
      { kind: 'journal', id: event.payload.journalEntryId },
      (value) => {
        value.archived = event.payload.archived
      },
    )
  })
  .apply(taskAddedEvent, async (event, state) => {
    state.items.push(
      item(
        state,
        event.id,
        event.type,
        event.payload.taskId,
        event.payload.createdAt,
        event.payload.title,
        'Task created',
        { kind: 'task', id: event.payload.taskId },
      ),
    )
  })
  .apply(taskEditedEvent, async (event, state) => {
    updateSubject(
      state,
      { kind: 'task', id: event.payload.taskId },
      (value) => {
        value.title = event.payload.title
      },
    )
  })
  .apply(taskCompletionChangedEvent, async (event, state) => {
    const ref = { kind: 'task' as const, id: event.payload.taskId }
    const title =
      [...state.items].reverse().find((value) => sameRef(value.subject, ref))
        ?.title ?? 'Task'
    state.items.push(
      item(
        state,
        event.id,
        event.type,
        event.payload.taskId,
        event.payload.changedAt,
        title,
        event.payload.completed ? 'Task completed' : 'Task reopened',
        ref,
      ),
    )
  })
  .apply(taskArchiveChangedEvent, async (event, state) => {
    updateSubject(
      state,
      { kind: 'task', id: event.payload.taskId },
      (value) => {
        value.archived = event.payload.archived
      },
    )
  })
  .apply(topicAddedEvent, async (event, state) => {
    state.items.push(
      item(
        state,
        event.id,
        event.type,
        event.payload.topicId,
        event.payload.createdAt,
        event.payload.name,
        'Topic created',
        { kind: 'topic', id: event.payload.topicId },
      ),
    )
  })
  .apply(topicEditedEvent, async (event, state) => {
    updateSubject(
      state,
      { kind: 'topic', id: event.payload.topicId },
      (value) => {
        value.title = event.payload.name
      },
    )
  })
  .apply(topicArchiveChangedEvent, async (event, state) => {
    updateSubject(
      state,
      { kind: 'topic', id: event.payload.topicId },
      (value) => {
        value.archived = event.payload.archived
      },
    )
  })
  .apply(recordsConnectedEvent, async (event, state) => {
    state.items.push(
      item(
        state,
        event.id,
        event.type,
        event.payload.connectionId,
        event.payload.connectedAt,
        'Records connected',
        `${labelRef(state, event.payload.left)} ↔ ${labelRef(state, event.payload.right)}`,
        null,
      ),
    )
  })
  .apply(connectionArchiveChangedEvent, async (event, state) => {
    const connectionItem = state.items.find(
      (candidate) =>
        candidate.eventType === 'records-connected' &&
        candidate.sourceId === event.payload.connectionId,
    )
    if (connectionItem) connectionItem.archived = event.payload.archived
  })
  .handle(async (query, state) =>
    state.items
      .filter((value) => query.includeArchived || !value.archived)
      .sort(
        (a, b) =>
          b.activityAt.localeCompare(a.activityAt) || b.sequence - a.sequence,
      )
      .slice(0, query.limit)
      .map(({ sequence: _sequence, sourceId: _sourceId, ...value }) => value),
  )

function item(
  state: State,
  id: string,
  eventType: string,
  sourceId: string | null,
  activityAt: string,
  title: string,
  detail: string,
  subject: EntityRef | null,
): TimelineItem {
  state.sequence += 1
  return {
    id,
    eventType,
    sourceId,
    activityAt,
    title,
    detail,
    archived: false,
    subject,
    sequence: state.sequence,
  }
}

function sameRef(left: EntityRef | null, right: EntityRef) {
  return left?.kind === right.kind && left.id === right.id
}
function labelRef(state: State, ref: EntityRef) {
  return (
    [...state.items].reverse().find((value) => sameRef(value.subject, ref))
      ?.title ?? `${ref.kind}:${ref.id}`
  )
}
function updateSubject(
  state: State,
  ref: EntityRef,
  update: (item: TimelineItem) => void,
) {
  for (const value of state.items)
    if (sameRef(value.subject, ref)) update(value)
}
