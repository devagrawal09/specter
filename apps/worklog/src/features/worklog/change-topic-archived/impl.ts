import { z } from 'zod'

import {
  topicAddedEvent,
  topicArchiveChangedEvent,
  topicEditedEvent,
} from '../events'
import { createWorklogMemoryStore } from '../memory-store'
import type { Topic } from '../model'
import { changeTopicArchivedSpec } from './spec'

const store = createWorklogMemoryStore(() => ({
  topics: new Map<string, Topic>(),
}))

export const changeTopicArchived = changeTopicArchivedSpec
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
  .handle(async (command, state) => {
    const topic = state.topics.get(command.topicId)
    if (!topic) throw new Error('Topic not found')
    if (topic.archived === command.archived)
      throw new Error('Topic archival state is already requested')
    return [topicArchiveChangedEvent.create(command)]
  })
