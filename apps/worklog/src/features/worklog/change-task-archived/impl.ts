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
  taskEditedEvent,
  topicAddedEvent,
  topicArchiveChangedEvent,
} from '../events'
import { defineWorklogMemoryStore } from '../memory-store'
import {
  otherEnd,
  references,
  type Connection,
  type EntityRef,
  type Task,
  type Topic,
} from '../model'
import { changeTaskArchivedSpec } from './spec'

type State = {
  journals: Map<string, { archived: boolean }>
  tasks: Map<string, Task>
  topics: Map<string, Topic>
  connections: Map<string, Connection>
  awards: Set<string>
}

const store = defineWorklogMemoryStore<State>(() => ({
  journals: new Map(),
  tasks: new Map<string, Task>(),
  topics: new Map<string, Topic>(),
  connections: new Map<string, Connection>(),
  awards: new Set<string>(),
}))

export const changeTaskArchived = changeTaskArchivedSpec
  .inputSchema(
    z
      .object({
        taskId: z.string().min(1),
        archived: z.boolean(),
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
    if (!task) throw new Error('Task not found')
    if (task.archived === command.archived)
      throw new Error('Task archival state is already requested')
    const events: EventDraft[] = [taskArchiveChangedEvent.create(command)]
    const taskRef = { kind: 'task' as const, id: task.id }
    const activeConnections = [...state.connections.values()]
      .filter(
        (connection) =>
          !connection.archived &&
          references(connection, taskRef) &&
          isActive(otherEnd(connection, taskRef), state),
      )
      .sort((left, right) => left.id.localeCompare(right.id))

    if (command.archived) {
      const topicRefs = uniqueTopicRefs(activeConnections, taskRef)
      appendEligibleTopicAwards(events, topicRefs, command.changedAt, state, {
        excludedTaskId: task.id,
      })
      return events
    }

    if (!task.completed) return events

    for (const connection of activeConnections) {
      const awardKey = `connection:${connection.id}:completed-task`
      if (state.awards.has(awardKey)) continue
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

    appendEligibleTopicAwards(
      events,
      uniqueTopicRefs(activeConnections, taskRef),
      command.changedAt,
      state,
      { includedTaskId: task.id },
    )
    return events
  })

function isActive(ref: EntityRef, state: State) {
  if (ref.kind === 'journal')
    return state.journals.get(ref.id)?.archived === false
  if (ref.kind === 'task') return state.tasks.get(ref.id)?.archived === false
  if (ref.kind === 'topic') return state.topics.get(ref.id)?.archived === false
  return false
}

function topicTasks(
  topicRef: EntityRef,
  state: State,
  prospective: {
    readonly includedTaskId?: string
    readonly excludedTaskId?: string
  },
) {
  const tasks = new Map<string, EntityRef>()
  for (const connection of state.connections.values()) {
    if (connection.archived || !references(connection, topicRef)) continue
    const other = otherEnd(connection, topicRef)
    if (
      other.kind === 'task' &&
      other.id !== prospective.excludedTaskId &&
      (other.id === prospective.includedTaskId ||
        state.tasks.get(other.id)?.archived === false)
    )
      tasks.set(other.id, other)
  }
  return [...tasks.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  )
}

function uniqueTopicRefs(
  connections: readonly Connection[],
  taskRef: EntityRef,
) {
  const topics = new Map<string, EntityRef>()
  for (const connection of connections) {
    const other = otherEnd(connection, taskRef)
    if (other.kind === 'topic') topics.set(other.id, other)
  }
  return [...topics.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  )
}

function appendEligibleTopicAwards(
  events: EventDraft[],
  topicRefs: readonly EntityRef[],
  awardedAt: string,
  state: State,
  prospective: {
    readonly includedTaskId?: string
    readonly excludedTaskId?: string
  },
) {
  for (const topicRef of topicRefs) {
    const awardKey = `topic:${topicRef.id}:all-tasks-completed`
    if (
      state.awards.has(awardKey) ||
      state.topics.get(topicRef.id)?.archived !== false
    )
      continue
    const tasks = topicTasks(topicRef, state, prospective)
    if (
      tasks.length >= 3 &&
      tasks.every((ref) => state.tasks.get(ref.id)?.completed)
    )
      events.push(
        pointAwardedEvent.create({
          awardKey,
          reason: 'topic-all-tasks-completed',
          points: 1,
          subject: topicRef,
          related: tasks,
          awardedAt,
        }),
      )
  }
}
