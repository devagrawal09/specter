import { z } from 'zod'

import {
  taskAddedEvent,
  taskArchiveChangedEvent,
  taskEditedEvent,
} from '../events'
import { defineWorklogMemoryStore } from '../memory-store'
import type { Task } from '../model'
import { editTaskSpec } from './spec'

const store = defineWorklogMemoryStore(() => ({
  tasks: new Map<string, Task>(),
}))

export const editTask = editTaskSpec
  .inputSchema(
    z
      .object({
        taskId: z.string().min(1),
        title: z.string().min(1).max(200),
        notes: z.string().max(10_000).nullable(),
        dueAt: z.string().datetime({ offset: true }).nullable(),
        editedAt: z.string().datetime({ offset: true }),
      })
      .strict(),
  )
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
  .apply(taskArchiveChangedEvent, async (event, state) => {
    const task = state.tasks.get(event.payload.taskId)
    if (task) task.archived = event.payload.archived
  })
  .handle(async (command, state) => {
    const task = state.tasks.get(command.taskId)
    if (!task || task.archived) throw new Error('Task not found')
    const title = command.title.trim()
    if (!title) throw new Error('Task title is required')
    return [
      taskEditedEvent.create({
        ...command,
        title,
        notes: command.notes?.trim() || null,
      }),
    ]
  })
