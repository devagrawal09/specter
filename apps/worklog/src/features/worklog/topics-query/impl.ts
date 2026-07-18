import { z } from 'zod'

import {
  connectionArchiveChangedEvent,
  recordsConnectedEvent,
  taskAddedEvent,
  taskArchiveChangedEvent,
  taskCompletionChangedEvent,
  topicAddedEvent,
  topicArchiveChangedEvent,
  topicEditedEvent,
} from '../events'
import { createWorklogMemoryStore } from '../memory-store'
import {
  otherEnd,
  references,
  type Connection,
  type Task,
  type Topic,
} from '../model'
import { topicsQuerySpec } from './spec'

type State = {
  topics: Map<string, Topic>
  tasks: Map<string, Task>
  connections: Map<string, Connection>
}
const store = createWorklogMemoryStore<State>(() => ({
  topics: new Map(),
  tasks: new Map(),
  connections: new Map(),
}))

export const topicsQuery = topicsQuerySpec
  .inputSchema(z.object({ includeArchived: z.boolean() }).strict())
  .outputSchema(
    z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          description: z.string().nullable(),
          createdAt: z.string(),
          archived: z.boolean(),
          taskCount: z.number().int(),
          completedTaskCount: z.number().int(),
        })
        .strict(),
    ),
  )
  .store(store)
  .apply(topicAddedEvent, async (event, state) => {
    state.topics.set(event.payload.topicId, {
      id: event.payload.topicId,
      name: event.payload.name,
      description: event.payload.description,
      createdAt: event.payload.createdAt,
      archived: false,
    })
  })
  .apply(topicEditedEvent, async (event, state) => {
    const topic = state.topics.get(event.payload.topicId)
    if (topic)
      Object.assign(topic, {
        name: event.payload.name,
        description: event.payload.description,
      })
  })
  .apply(topicArchiveChangedEvent, async (event, state) => {
    const topic = state.topics.get(event.payload.topicId)
    if (topic) topic.archived = event.payload.archived
  })
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
  .handle(async (query, state) =>
    [...state.topics.values()]
      .filter((topic) => query.includeArchived || !topic.archived)
      .map((topic) => {
        const topicRef = { kind: 'topic' as const, id: topic.id }
        const taskIds = new Set(
          [...state.connections.values()]
            .filter(
              (connection) =>
                !connection.archived && references(connection, topicRef),
            )
            .map((connection) => otherEnd(connection, topicRef))
            .filter((ref) => ref.kind === 'task')
            .map((ref) => ref.id),
        )
        const tasks = [...taskIds]
          .map((id) => state.tasks.get(id))
          .filter((task): task is Task => Boolean(task && !task.archived))
        return {
          ...topic,
          taskCount: tasks.length,
          completedTaskCount: tasks.filter((task) => task.completed).length,
        }
      })
      .sort((left, right) => left.name.localeCompare(right.name)),
  )
