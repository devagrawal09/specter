import { z } from 'zod'

import {
  connectionArchiveChangedEvent,
  recordsConnectedEvent,
  taskAddedEvent,
  taskArchiveChangedEvent,
  taskCompletionChangedEvent,
  taskEditedEvent,
} from '../events'
import { defineWorklogMemoryStore } from '../memory-store'
import { references, type Connection, type Task } from '../model'
import specification from './spec.json' with { type: 'json' }
import { implementQuery } from '@specter-ts/core'

type State = { tasks: Map<string, Task>; connections: Map<string, Connection> }
const store = defineWorklogMemoryStore<State>(() => ({
  tasks: new Map(),
  connections: new Map(),
}))

const outputSchema = z.array(
  z
    .object({
      id: z.string(),
      title: z.string(),
      notes: z.string().nullable(),
      dueAt: z.string().nullable(),
      createdAt: z.string(),
      completed: z.boolean(),
      completedAt: z.string().nullable(),
      archived: z.boolean(),
    })
    .strict(),
)

export const tasksQuery = implementQuery(specification)
  .inputSchema(
    z
      .object({
        status: z.enum(['all', 'open', 'completed', 'archived']),
        topicId: z.string().nullable(),
      })
      .strict(),
  )
  .outputSchema(outputSchema)
  .store(store)
  .apply(taskAddedEvent, async (event, state) => {
    state.tasks.set(event.payload.taskId, {
      id: event.payload.taskId,
      title: event.payload.title,
      notes: event.payload.notes,
      dueAt: event.payload.dueAt,
      createdAt: event.payload.createdAt,
      completed: false,
      completedAt: null,
      archived: false,
    })
  })
  .apply(taskEditedEvent, async (event, state) => {
    const task = state.tasks.get(event.payload.taskId)
    if (task)
      Object.assign(task, {
        title: event.payload.title,
        notes: event.payload.notes,
        dueAt: event.payload.dueAt,
      })
  })
  .apply(taskCompletionChangedEvent, async (event, state) => {
    const task = state.tasks.get(event.payload.taskId)
    if (task) {
      task.completed = event.payload.completed
      task.completedAt = event.payload.completed
        ? event.payload.changedAt
        : null
    }
  })
  .apply(taskArchiveChangedEvent, async (event, state) => {
    const task = state.tasks.get(event.payload.taskId)
    if (task) task.archived = event.payload.archived
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
  .handle(async (query, state) => {
    const topicRef = query.topicId
      ? { kind: 'topic' as const, id: query.topicId }
      : undefined
    const connectedTaskIds = topicRef
      ? new Set(
          [...state.connections.values()]
            .filter(
              (connection) =>
                !connection.archived && references(connection, topicRef),
            )
            .flatMap((connection) => [connection.left, connection.right])
            .filter((ref) => ref.kind === 'task')
            .map((ref) => ref.id),
        )
      : undefined
    return [...state.tasks.values()]
      .filter((task) => !connectedTaskIds || connectedTaskIds.has(task.id))
      .filter((task) =>
        query.status === 'all'
          ? !task.archived
          : query.status === 'archived'
            ? task.archived
            : !task.archived &&
              (query.status === 'completed' ? task.completed : !task.completed),
      )
      .sort(compareTasks)
  })

function compareTasks(left: Task, right: Task) {
  if (left.dueAt && right.dueAt) return left.dueAt.localeCompare(right.dueAt)
  if (left.dueAt) return -1
  if (right.dueAt) return 1
  return right.createdAt.localeCompare(left.createdAt)
}
