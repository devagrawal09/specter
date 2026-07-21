import { z } from 'zod'
import type { EventDraft } from '@specter-ts/core'

import {
  connectionArchiveChangedEvent,
  journalEntryAddedEvent,
  journalEntryArchiveChangedEvent,
  pointAwardedEvent,
  recordsConnectedEvent,
  taskAddedEvent,
  taskArchiveChangedEvent,
  taskCompletionChangedEvent,
  topicAddedEvent,
  topicArchiveChangedEvent,
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
import { changeTaskCompletionSpec } from './spec'

type State = {
  journals: Map<string, { archived: boolean }>
  tasks: Map<string, Task>
  topics: Map<string, Topic>
  connections: Map<string, Connection>
  awards: Set<string>
}
const store = createWorklogMemoryStore<State>(() => ({
  journals: new Map(),
  tasks: new Map(),
  topics: new Map(),
  connections: new Map(),
  awards: new Set(),
}))

export const changeTaskCompletion = changeTaskCompletionSpec
  .inputSchema(
    z
      .object({
        taskId: z.string().min(1),
        completed: z.boolean(),
        changedAt: z.string().datetime({ offset: true }),
      })
      .strict(),
  )
  .store(store)
  .apply(journalEntryAddedEvent, async (event, state) => {
    state.journals.set(event.payload.journalEntryId, { archived: false })
  })
  .apply(journalEntryArchiveChangedEvent, async (event, state) => {
    const journal = state.journals.get(event.payload.journalEntryId)
    if (journal) journal.archived = event.payload.archived
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
  .apply(topicAddedEvent, async (event, state) => {
    state.topics.set(event.payload.topicId, {
      id: event.payload.topicId,
      name: event.payload.name,
      description: event.payload.description,
      createdAt: event.payload.createdAt,
      archived: false,
    })
  })
  .apply(topicArchiveChangedEvent, async (event, state) => {
    const topic = state.topics.get(event.payload.topicId)
    if (topic) topic.archived = event.payload.archived
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
    const task = state.tasks.get(command.taskId)
    if (!task || task.archived) throw new Error('Task not found')
    if (task.completed === command.completed)
      throw new Error('Task completion is already in requested state')
    const events: EventDraft[] = [taskCompletionChangedEvent.create(command)]
    if (!command.completed) return events

    const taskRef = { kind: 'task' as const, id: task.id }
    const completionKey = `task:${task.id}:first-completion`
    if (!state.awards.has(completionKey))
      events.push(
        pointAwardedEvent.create({
          awardKey: completionKey,
          reason: 'task-first-completed',
          points: 1,
          subject: taskRef,
          related: [],
          awardedAt: command.changedAt,
        }),
      )

    const activeConnections = [...state.connections.values()]
      .filter(
        (connection) =>
          !connection.archived &&
          references(connection, taskRef) &&
          isActive(otherEnd(connection, taskRef), state),
      )
      .sort((a, b) => a.id.localeCompare(b.id))
    for (const connection of activeConnections) {
      const awardKey = `connection:${connection.id}:completed-task`
      if (!state.awards.has(awardKey))
        events.push(
          pointAwardedEvent.create({
            awardKey,
            reason: 'completed-task-connection',
            points: 1,
            subject: taskRef,
            related: [otherEnd(connection, taskRef)],
            awardedAt: command.changedAt,
          }),
        )
    }

    const topicRefs = activeConnections
      .map((connection) => otherEnd(connection, taskRef))
      .filter((ref): ref is EntityRef => ref.kind === 'topic')
    for (const topicRef of topicRefs.sort((a, b) => a.id.localeCompare(b.id))) {
      const awardKey = `topic:${topicRef.id}:all-tasks-completed`
      if (
        state.awards.has(awardKey) ||
        state.topics.get(topicRef.id)?.archived !== false
      )
        continue
      const tasks = topicTasks(topicRef, state)
      if (
        tasks.length < 3 ||
        !tasks.every(
          (ref) => ref.id === task.id || state.tasks.get(ref.id)?.completed,
        )
      )
        continue
      events.push(
        pointAwardedEvent.create({
          awardKey,
          reason: 'topic-all-tasks-completed',
          points: 1,
          subject: topicRef,
          related: tasks,
          awardedAt: command.changedAt,
        }),
      )
    }
    return events
  })

function topicTasks(topicRef: EntityRef, state: State) {
  const tasks = new Map<string, EntityRef>()
  for (const connection of state.connections.values()) {
    if (connection.archived || !references(connection, topicRef)) continue
    const other = otherEnd(connection, topicRef)
    if (other.kind === 'task' && state.tasks.get(other.id)?.archived === false)
      tasks.set(other.id, other)
  }
  return [...tasks.values()].sort((a, b) => a.id.localeCompare(b.id))
}

function isActive(ref: EntityRef, state: State) {
  if (ref.kind === 'journal')
    return state.journals.get(ref.id)?.archived === false
  if (ref.kind === 'task') return state.tasks.get(ref.id)?.archived === false
  return state.topics.get(ref.id)?.archived === false
}
