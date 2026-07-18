import { z } from 'zod'

import {
  taskAddedEvent,
  taskArchiveChangedEvent,
  taskEditedEvent,
} from '../events'
import { createWorklogMemoryStore } from '../memory-store'
import type { Task } from '../model'
import { changeTaskArchivedSpec } from './spec'

const store = createWorklogMemoryStore(() => ({
  tasks: new Map<string, Task>(),
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
    if (!task) throw new Error('Task not found')
    if (task.archived === command.archived)
      throw new Error('Task archival state is already requested')
    return [taskArchiveChangedEvent.create(command)]
  })
