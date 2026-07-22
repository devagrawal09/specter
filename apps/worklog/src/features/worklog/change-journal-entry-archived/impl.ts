import { z } from 'zod'
import type { EventDraft } from '@specter-ts/core'

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
} from '../events'
import { createWorklogMemoryStore } from '../memory-store'
import {
  otherEnd,
  references,
  type Connection,
  type JournalEntry,
  type Task,
} from '../model'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'

type State = {
  journals: Map<string, JournalEntry>
  tasks: Map<string, Task>
  connections: Map<string, Connection>
  awards: Set<string>
}

const store = createWorklogMemoryStore<State>(() => ({
  journals: new Map<string, JournalEntry>(),
  tasks: new Map<string, Task>(),
  connections: new Map<string, Connection>(),
  awards: new Set<string>(),
}))

export const changeJournalEntryArchived =
  implementCommand<'changeJournalEntryArchived'>(specification)
    .inputSchema(
      z
        .object({
          journalEntryId: z.string().min(1),
          archived: z.boolean(),
          changedAt: z.string().datetime({ offset: true }),
        })
        .strict(),
    )
    .store(store)
    .apply(journalEntryAddedEvent, async (event, state) => {
      state.journals.set(event.payload.journalEntryId, {
        id: event.payload.journalEntryId,
        body: event.payload.body,
        activityAt: event.payload.activityAt,
        createdAt: event.payload.createdAt,
        archived: false,
      })
    })
    .apply(journalEntryEditedEvent, async (event, state) => {
      const journal = state.journals.get(event.payload.journalEntryId)
      if (journal)
        Object.assign(journal, {
          body: event.payload.body,
          activityAt: event.payload.activityAt,
        })
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
      const journal = state.journals.get(command.journalEntryId)
      if (!journal) throw new Error('Journal entry not found')
      if (journal.archived === command.archived)
        throw new Error('Journal entry archival state is already requested')
      const events: EventDraft[] = [
        journalEntryArchiveChangedEvent.create(command),
      ]
      if (command.archived) return events

      const journalRef = { kind: 'journal' as const, id: journal.id }
      const taskConnections = [...state.connections.values()]
        .filter(
          (connection) =>
            !connection.archived && references(connection, journalRef),
        )
        .map((connection) => ({
          connection,
          other: otherEnd(connection, journalRef),
        }))
        .filter(
          ({ other }) =>
            other.kind === 'task' &&
            state.tasks.get(other.id)?.archived === false &&
            state.tasks.get(other.id)?.completed,
        )
        .sort((left, right) =>
          left.connection.id.localeCompare(right.connection.id),
        )

      for (const { connection, other } of taskConnections) {
        if (other.kind !== 'task') continue
        const awardKey = `connection:${connection.id}:completed-task`
        if (state.awards.has(awardKey)) continue
        events.push(
          pointAwardedEvent.create({
            awardKey,
            reason: 'completed-task-connection',
            points: 1,
            subject: other,
            related: [journalRef],
            awardedAt: command.changedAt,
          }),
        )
      }
      return events
    })
