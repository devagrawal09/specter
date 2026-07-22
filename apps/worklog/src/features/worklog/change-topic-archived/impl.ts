import { z } from 'zod'
import type { EventDraft } from '@specter-ts/core'

import {
  connectionArchiveChangedEvent,
  pointAwardedEvent,
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
  type EntityRef,
  type Task,
  type Topic,
} from '../model'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'

type State = {
  topics: Map<string, Topic>
  tasks: Map<string, Task>
  connections: Map<string, Connection>
  awards: Set<string>
}

const store = createWorklogMemoryStore<State>(() => ({
  topics: new Map<string, Topic>(),
  tasks: new Map<string, Task>(),
  connections: new Map<string, Connection>(),
  awards: new Set<string>(),
}))

export const changeTopicArchived = implementCommand<'changeTopicArchived'>(
  specification,
)
  .inputSchema(
    z
      .object({
        topicId: z.string().min(1),
        archived: z.boolean(),
        changedAt: z.string().datetime({ offset: true }),
      })
      .strict(),
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
  .apply(pointAwardedEvent, async (event, state) => {
    state.awards.add(event.payload.awardKey)
  })
  .handle(async (command, state) => {
    const topic = state.topics.get(command.topicId)
    if (!topic) throw new Error('Topic not found')
    if (topic.archived === command.archived)
      throw new Error('Topic archival state is already requested')
    const events: EventDraft[] = [topicArchiveChangedEvent.create(command)]
    if (command.archived) return events

    const topicRef = { kind: 'topic' as const, id: topic.id }
    const taskConnections = [...state.connections.values()]
      .filter(
        (connection) =>
          !connection.archived && references(connection, topicRef),
      )
      .map((connection) => ({
        connection,
        taskRef: otherEnd(connection, topicRef),
      }))
      .filter(
        (value): value is { connection: Connection; taskRef: EntityRef } =>
          value.taskRef.kind === 'task' &&
          state.tasks.get(value.taskRef.id)?.archived === false,
      )
      .sort((left, right) =>
        left.connection.id.localeCompare(right.connection.id),
      )

    for (const { connection, taskRef } of taskConnections) {
      if (!state.tasks.get(taskRef.id)?.completed) continue
      const awardKey = `connection:${connection.id}:completed-task`
      if (state.awards.has(awardKey)) continue
      events.push(
        pointAwardedEvent.create({
          awardKey,
          reason: 'completed-task-connection',
          points: 1,
          subject: taskRef,
          related: [topicRef],
          awardedAt: command.changedAt,
        }),
      )
    }

    const tasks = new Map<string, EntityRef>()
    for (const { taskRef } of taskConnections) tasks.set(taskRef.id, taskRef)
    const related = [...tasks.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    )
    const milestoneKey = `topic:${topic.id}:all-tasks-completed`
    if (
      !state.awards.has(milestoneKey) &&
      related.length >= 3 &&
      related.every((ref) => state.tasks.get(ref.id)?.completed)
    )
      events.push(
        pointAwardedEvent.create({
          awardKey: milestoneKey,
          reason: 'topic-all-tasks-completed',
          points: 1,
          subject: topicRef,
          related,
          awardedAt: command.changedAt,
        }),
      )

    return events
  })
