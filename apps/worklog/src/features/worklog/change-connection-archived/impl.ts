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
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'

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

export const changeConnectionArchived =
  implementCommand<'changeConnectionArchived'>(specification)
    .inputSchema(
      z
        .object({
          connectionId: z.string().min(1),
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
      const connection = state.connections.get(command.connectionId)
      if (!connection) throw new Error('Connection not found')
      if (connection.archived === command.archived)
        throw new Error('Connection archival state is already requested')
      const events: EventDraft[] = [
        connectionArchiveChangedEvent.create(command),
      ]
      if (
        !isActive(connection.left, state) ||
        !isActive(connection.right, state)
      )
        return events

      const taskRef =
        connection.left.kind === 'task'
          ? connection.left
          : connection.right.kind === 'task'
            ? connection.right
            : undefined
      const topicRef =
        connection.left.kind === 'topic'
          ? connection.left
          : connection.right.kind === 'topic'
            ? connection.right
            : undefined
      if (command.archived) {
        if (taskRef && topicRef)
          appendEligibleTopicAward(events, topicRef, command.changedAt, state, {
            excludedConnectionId: connection.id,
          })
        return events
      }

      if (taskRef && state.tasks.get(taskRef.id)?.completed) {
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

      if (taskRef && topicRef) {
        appendEligibleTopicAward(events, topicRef, command.changedAt, state, {
          includedConnectionId: connection.id,
        })
      }
      return events
    })

function isActive(ref: EntityRef, state: State) {
  if (ref.kind === 'journal')
    return state.journals.get(ref.id)?.archived === false
  if (ref.kind === 'task') return state.tasks.get(ref.id)?.archived === false
  return state.topics.get(ref.id)?.archived === false
}

function topicTasks(
  topicRef: EntityRef,
  state: State,
  prospective: {
    readonly includedConnectionId?: string
    readonly excludedConnectionId?: string
  },
) {
  const tasks = new Map<string, EntityRef>()
  for (const connection of state.connections.values()) {
    if (
      connection.id === prospective.excludedConnectionId ||
      (connection.archived &&
        connection.id !== prospective.includedConnectionId) ||
      !references(connection, topicRef)
    )
      continue
    const other = otherEnd(connection, topicRef)
    if (other.kind === 'task' && state.tasks.get(other.id)?.archived === false)
      tasks.set(other.id, other)
  }
  return [...tasks.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  )
}

function appendEligibleTopicAward(
  events: EventDraft[],
  topicRef: EntityRef,
  awardedAt: string,
  state: State,
  prospective: {
    readonly includedConnectionId?: string
    readonly excludedConnectionId?: string
  },
) {
  const awardKey = `topic:${topicRef.id}:all-tasks-completed`
  if (
    state.awards.has(awardKey) ||
    state.topics.get(topicRef.id)?.archived !== false
  )
    return
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
