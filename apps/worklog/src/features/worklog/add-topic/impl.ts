import { z } from 'zod'

import { pointAwardedEvent, topicAddedEvent } from '../events'
import { createWorklogMemoryStore } from '../memory-store'
import { addTopicSpec } from './spec'

const store = createWorklogMemoryStore(() => ({ ids: new Set<string>() }))

export const addTopic = addTopicSpec
  .inputSchema(
    z
      .object({
        topicId: z.string().min(1),
        name: z.string().min(1).max(120),
        description: z.string().max(10_000).nullable(),
        createdAt: z.string().datetime({ offset: true }),
      })
      .strict(),
  )
  .store(store)
  .apply(topicAddedEvent, async (event, state) => {
    state.ids.add(event.payload.topicId)
  })
  .handle(async (command, state) => {
    if (state.ids.has(command.topicId)) throw new Error('Topic already exists')
    const name = command.name.trim()
    if (!name) throw new Error('Topic name is required')
    return [
      topicAddedEvent.create({
        ...command,
        name,
        description: command.description?.trim() || null,
      }),
      pointAwardedEvent.create({
        awardKey: `topic:${command.topicId}:created`,
        reason: 'topic-added',
        points: 1,
        subject: { kind: 'topic', id: command.topicId },
        related: [],
        awardedAt: command.createdAt,
      }),
    ]
  })
