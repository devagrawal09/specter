import { implementQuery } from '@specter-ts/core'
import { z } from 'zod'

import {
  connectionArchiveChangedEvent,
  journalEntryAddedEvent,
  journalEntryArchiveChangedEvent,
  journalEntryEditedEvent,
  pointAwardedEvent,
  recordsConnectedEvent,
  taskAddedEvent,
  taskArchiveChangedEvent,
  taskCompletionChangedEvent,
  taskEditedEvent,
  topicAddedEvent,
  topicArchiveChangedEvent,
  topicEditedEvent,
} from '../events'
import { defineWorklogMemoryStore } from '../memory-store'
import type { Connection, EntityKind, PointAward, PointReason } from '../model'
import specification from './spec.json' with { type: 'json' }

type GardenRecord = {
  id: string
  kind: EntityKind
  label: string
  detail: string | null
  createdAt: string
  archived: boolean
}

type State = {
  records: Map<string, GardenRecord>
  connections: Map<string, Connection>
  awards: Map<string, PointAward>
}

const store = defineWorklogMemoryStore<State>(() => ({
  records: new Map(),
  connections: new Map(),
  awards: new Map(),
}))

const effectReasonSchema = z.enum([
  'task-first-completed',
  'completed-task-connection',
  'topic-all-tasks-completed',
])
const effectSchema = z
  .object({ reason: effectReasonSchema, awardedAt: z.string() })
  .strict()
const refSchema = z
  .object({ kind: z.enum(['journal', 'task', 'topic']), id: z.string() })
  .strict()

export const gardenQuery = implementQuery(specification)
  .inputSchema(z.object({}).strict())
  .outputSchema(
    z
      .object({
        totalPoints: z.number().int().nonnegative(),
        records: z.array(
          z
            .object({
              id: z.string(),
              kind: z.enum(['journal', 'task', 'topic']),
              label: z.string(),
              detail: z.string().nullable(),
              createdAt: z.string(),
              archived: z.boolean(),
              effects: z.array(effectSchema),
            })
            .strict(),
        ),
        connections: z.array(
          z
            .object({
              id: z.string(),
              left: refSchema,
              right: refSchema,
              connectedAt: z.string(),
              archived: z.boolean(),
              effects: z.array(effectSchema),
            })
            .strict(),
        ),
      })
      .strict(),
  )
  .store(store)
  .apply(journalEntryAddedEvent, async (event, state) => {
    state.records.set(recordKey('journal', event.payload.journalEntryId), {
      id: event.payload.journalEntryId,
      kind: 'journal',
      label: event.payload.body,
      detail: event.payload.body,
      createdAt: event.payload.createdAt,
      archived: false,
    })
  })
  .apply(journalEntryEditedEvent, async (event, state) => {
    const record = state.records.get(
      recordKey('journal', event.payload.journalEntryId),
    )
    if (record) {
      record.label = event.payload.body
      record.detail = event.payload.body
    }
  })
  .apply(journalEntryArchiveChangedEvent, async (event, state) => {
    const record = state.records.get(
      recordKey('journal', event.payload.journalEntryId),
    )
    if (record) record.archived = event.payload.archived
  })
  .apply(taskAddedEvent, async (event, state) => {
    state.records.set(recordKey('task', event.payload.taskId), {
      id: event.payload.taskId,
      kind: 'task',
      label: event.payload.title,
      detail: event.payload.notes,
      createdAt: event.payload.createdAt,
      archived: false,
    })
  })
  .apply(taskEditedEvent, async (event, state) => {
    const record = state.records.get(recordKey('task', event.payload.taskId))
    if (record) {
      record.label = event.payload.title
      record.detail = event.payload.notes
    }
  })
  .apply(taskCompletionChangedEvent, async () => undefined)
  .apply(taskArchiveChangedEvent, async (event, state) => {
    const record = state.records.get(recordKey('task', event.payload.taskId))
    if (record) record.archived = event.payload.archived
  })
  .apply(topicAddedEvent, async (event, state) => {
    state.records.set(recordKey('topic', event.payload.topicId), {
      id: event.payload.topicId,
      kind: 'topic',
      label: event.payload.name,
      detail: event.payload.description,
      createdAt: event.payload.createdAt,
      archived: false,
    })
  })
  .apply(topicEditedEvent, async (event, state) => {
    const record = state.records.get(recordKey('topic', event.payload.topicId))
    if (record) {
      record.label = event.payload.name
      record.detail = event.payload.description
    }
  })
  .apply(topicArchiveChangedEvent, async (event, state) => {
    const record = state.records.get(recordKey('topic', event.payload.topicId))
    if (record) record.archived = event.payload.archived
  })
  .apply(recordsConnectedEvent, async (event, state) => {
    state.connections.set(event.payload.connectionId, {
      id: event.payload.connectionId,
      left: event.payload.left,
      right: event.payload.right,
      connectedAt: event.payload.connectedAt,
      archived: false,
    })
  })
  .apply(connectionArchiveChangedEvent, async (event, state) => {
    const connection = state.connections.get(event.payload.connectionId)
    if (connection) connection.archived = event.payload.archived
  })
  .apply(pointAwardedEvent, async (event, state) => {
    state.awards.set(event.payload.awardKey, event.payload)
  })
  .handle(async (_query, state) => ({
    totalPoints: [...state.awards.values()].reduce(
      (total, award) => total + award.points,
      0,
    ),
    records: [...state.records.values()]
      .filter((record) =>
        state.awards.has(`${record.kind}:${record.id}:created`),
      )
      .sort(compareCreated)
      .map((record) => ({ ...record, effects: recordEffects(record, state) })),
    connections: [...state.connections.values()]
      .filter((connection) =>
        state.awards.has(`connection:${connection.id}:created`),
      )
      .sort(
        (left, right) =>
          left.connectedAt.localeCompare(right.connectedAt) ||
          left.id.localeCompare(right.id),
      )
      .map((connection) => ({
        ...connection,
        effects: milestoneEffects([
          state.awards.get(`connection:${connection.id}:completed-task`),
        ]),
      })),
  }))

function recordKey(kind: EntityKind, id: string) {
  return `${kind}:${id}`
}

function compareCreated(left: GardenRecord, right: GardenRecord) {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.kind.localeCompare(right.kind) ||
    left.id.localeCompare(right.id)
  )
}

function recordEffects(record: GardenRecord, state: State) {
  if (record.kind === 'task')
    return milestoneEffects([
      state.awards.get(`task:${record.id}:first-completion`),
    ])
  if (record.kind === 'topic')
    return milestoneEffects([
      state.awards.get(`topic:${record.id}:all-tasks-completed`),
    ])
  return []
}

function milestoneEffects(awards: Array<PointAward | undefined>) {
  return awards
    .filter((award): award is PointAward => Boolean(award))
    .filter(
      (
        award,
      ): award is PointAward & {
        reason: Extract<
          PointReason,
          | 'task-first-completed'
          | 'completed-task-connection'
          | 'topic-all-tasks-completed'
        >
      } =>
        award.reason === 'task-first-completed' ||
        award.reason === 'completed-task-connection' ||
        award.reason === 'topic-all-tasks-completed',
    )
    .map(({ reason, awardedAt }) => ({ reason, awardedAt }))
}
