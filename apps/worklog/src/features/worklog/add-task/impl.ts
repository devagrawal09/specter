import { z } from 'zod'

import { pointAwardedEvent, taskAddedEvent } from '../events'
import { defineWorklogMemoryStore } from '../memory-store'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'
const store = defineWorklogMemoryStore(() => ({ ids: new Set<string>() }))

export const addTask = implementCommand(specification)
  .inputSchema(
    z
      .object({
        taskId: z.string().min(1),
        title: z.string().min(1).max(200),
        notes: z.string().max(10_000).nullable(),
        dueAt: z.string().datetime({ offset: true }).nullable(),
        createdAt: z.string().datetime({ offset: true }),
      })
      .strict(),
  )
  .store(store)
  .apply(taskAddedEvent, async (event, state) => {
    state.ids.add(event.payload.taskId)
  })
  .handle(async (command, state) => {
    if (state.ids.has(command.taskId)) throw new Error('Task already exists')
    const title = command.title.trim()
    if (!title) throw new Error('Task title is required')
    const notes = command.notes?.trim() || null
    return [
      taskAddedEvent.create({ ...command, title, notes }),
      pointAwardedEvent.create({
        awardKey: `task:${command.taskId}:created`,
        reason: 'task-added',
        points: 1,
        subject: { kind: 'task', id: command.taskId },
        related: [],
        awardedAt: command.createdAt,
      }),
    ]
  })
