import { z } from 'zod'

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
import { defineWorklogMemoryStore } from '../memory-store'
import {
  connectionPairKey,
  otherEnd,
  references,
  type Connection,
  type EntityRef,
  type Task,
  type Topic,
} from '../model'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'

type EntityState = { archived: boolean }
type State = {
  journals: Map<string, EntityState>
  tasks: Map<string, Task>
  topics: Map<string, Topic>
  connections: Map<string, Connection>
  pairKeys: Set<string>
  awards: Set<string>
}

const store = defineWorklogMemoryStore<State>(() => ({
  journals: new Map(),
  tasks: new Map(),
  topics: new Map(),
  connections: new Map(),
  pairKeys: new Set(),
  awards: new Set(),
}))

const refSchema = z
  .object({ kind: z.enum(['journal', 'task', 'topic']), id: z.string().min(1) })
  .strict()

export const connectRecords = implementCommand(specification)
  .inputSchema(
    z
      .object({
        connectionId: z.string().min(1),
        left: refSchema,
        right: refSchema,
        connectedAt: z.string().datetime({ offset: true }),
      })
      .strict(),
  )
  .store(store)
  .apply(journalEntryAddedEvent, async (event, state) => {
    state.journals.set(event.payload.journalEntryId, { archived: false })
  })
  .apply(journalEntryArchiveChangedEvent, async (event, state) => {
    const value = state.journals.get(event.payload.journalEntryId)
    if (value) value.archived = event.payload.archived
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
    const value = state.tasks.get(event.payload.taskId)
    if (value) {
      value.completed = event.payload.completed
      value.completedAt = event.payload.completed
        ? event.payload.changedAt
        : null
    }
  })
  .apply(taskArchiveChangedEvent, async (event, state) => {
    const value = state.tasks.get(event.payload.taskId)
    if (value) value.archived = event.payload.archived
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
    const value = state.topics.get(event.payload.topicId)
    if (value) value.archived = event.payload.archived
  })
  .apply(recordsConnectedEvent, async (event, state) => {
    const connection = {
      id: event.payload.connectionId,
      left: event.payload.left,
      right: event.payload.right,
      connectedAt: event.payload.connectedAt,
      archived: false,
    }
    state.connections.set(connection.id, connection)
    state.pairKeys.add(connectionPairKey(connection.left, connection.right))
  })
  .apply(connectionArchiveChangedEvent, async (event, state) => {
    const value = state.connections.get(event.payload.connectionId)
    if (value) value.archived = event.payload.archived
  })
  .apply(pointAwardedEvent, async (event, state) => {
    state.awards.add(event.payload.awardKey)
  })
  .handle(async (command, state) => {
    validatePair(command.left, command.right)
    if (!isActive(command.left, state) || !isActive(command.right, state))
      throw new Error('Connection endpoint not found')
    if (state.connections.has(command.connectionId))
      throw new Error('Connection already exists')
    if (state.pairKeys.has(connectionPairKey(command.left, command.right)))
      throw new Error('Records are already connected')

    const events = [
      recordsConnectedEvent.create(command),
      pointAwardedEvent.create({
        awardKey: `connection:${command.connectionId}:created`,
        reason: 'connection-added',
        points: 1,
        subject: { kind: 'connection', id: command.connectionId },
        related: [command.left, command.right],
        awardedAt: command.connectedAt,
      }),
    ]
    const taskRef =
      command.left.kind === 'task'
        ? command.left
        : command.right.kind === 'task'
          ? command.right
          : undefined
    if (taskRef && state.tasks.get(taskRef.id)?.completed) {
      events.push(
        pointAwardedEvent.create({
          awardKey: `connection:${command.connectionId}:completed-task`,
          reason: 'completed-task-connection',
          points: 1,
          subject: taskRef,
          related: [taskRef === command.left ? command.right : command.left],
          awardedAt: command.connectedAt,
        }),
      )
    }

    const topicRef =
      command.left.kind === 'topic'
        ? command.left
        : command.right.kind === 'topic'
          ? command.right
          : undefined
    if (taskRef && topicRef && qualifiesTopic(topicRef, taskRef, state)) {
      const awardKey = `topic:${topicRef.id}:all-tasks-completed`
      if (!state.awards.has(awardKey)) {
        const tasks = topicTasks(topicRef, state, taskRef).sort((a, b) =>
          a.id.localeCompare(b.id),
        )
        events.push(
          pointAwardedEvent.create({
            awardKey,
            reason: 'topic-all-tasks-completed',
            points: 1,
            subject: topicRef,
            related: tasks,
            awardedAt: command.connectedAt,
          }),
        )
      }
    }
    return events
  })

function validatePair(left: EntityRef, right: EntityRef) {
  if (left.kind === right.kind && left.id === right.id)
    throw new Error('Cannot connect a record to itself')
  const kinds = [left.kind, right.kind].sort().join('|')
  if (
    !['journal|task', 'journal|topic', 'task|topic', 'topic|topic'].includes(
      kinds,
    )
  )
    throw new Error('Unsupported connection type')
}

function isActive(ref: EntityRef, state: State) {
  if (ref.kind === 'journal')
    return state.journals.get(ref.id)?.archived === false
  if (ref.kind === 'task') return state.tasks.get(ref.id)?.archived === false
  return state.topics.get(ref.id)?.archived === false
}

function topicTasks(topic: EntityRef, state: State, prospective?: EntityRef) {
  const refs = new Map<string, EntityRef>()
  for (const connection of state.connections.values()) {
    if (connection.archived || !references(connection, topic)) continue
    const other = otherEnd(connection, topic)
    if (other.kind === 'task' && state.tasks.get(other.id)?.archived === false)
      refs.set(other.id, other)
  }
  if (
    prospective?.kind === 'task' &&
    state.tasks.get(prospective.id)?.archived === false
  )
    refs.set(prospective.id, prospective)
  return [...refs.values()]
}

function qualifiesTopic(
  topic: EntityRef,
  prospective: EntityRef,
  state: State,
) {
  if (state.topics.get(topic.id)?.archived !== false) return false
  const tasks = topicTasks(topic, state, prospective)
  return (
    tasks.length >= 3 &&
    tasks.every((ref) => state.tasks.get(ref.id)?.completed)
  )
}
