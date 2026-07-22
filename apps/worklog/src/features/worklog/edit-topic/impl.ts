import { z } from 'zod'

import {
  topicAddedEvent,
  topicArchiveChangedEvent,
  topicEditedEvent,
} from '../events'
import { defineWorklogMemoryStore } from '../memory-store'
import type { Topic } from '../model'
import specification from './spec.json' with { type: 'json' }
import { implementCommand } from '@specter-ts/core'

const store = defineWorklogMemoryStore(() => ({
  topics: new Map<string, Topic>(),
}))

export const editTopic = implementCommand(specification)
  .inputSchema(
    z
      .object({
        topicId: z.string().min(1),
        name: z.string().min(1).max(120),
        description: z.string().max(10_000).nullable(),
        editedAt: z.string().datetime({ offset: true }),
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
  .handle(async (command, state) => {
    const topic = state.topics.get(command.topicId)
    if (!topic || topic.archived) throw new Error('Topic not found')
    const name = command.name.trim()
    if (!name) throw new Error('Topic name is required')
    return [
      topicEditedEvent.create({
        ...command,
        name,
        description: command.description?.trim() || null,
      }),
    ]
  })
