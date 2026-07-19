import { createCommandSlice, event } from '@specter-ts/core/spec'

const at = '2026-07-18T15:00:00.000Z'

export const addTopicSpec = createCommandSlice('addTopic')
  .description('Adds a topic for grouping related work.')
  .scenarios(
    {
      description: 'Adds a topic and awards its creation point.',
      given: [],
      when: {
        topicId: 'topic-1',
        name: 'Worklog',
        description: null,
        createdAt: at,
      },
      expect: [
        event('topic-added', {
          topicId: 'topic-1',
          name: 'Worklog',
          description: null,
          createdAt: at,
        }),
        event('point-awarded', {
          awardKey: 'topic:topic-1:created',
          reason: 'topic-added',
          points: 1,
          subject: { kind: 'topic', id: 'topic-1' },
          related: [],
          awardedAt: at,
        }),
      ],
    },
    {
      description: 'Rejects a reused topic identifier.',
      given: [
        event('topic-added', {
          topicId: 'topic-1',
          name: 'Existing',
          description: null,
          createdAt: at,
        }),
      ],
      when: {
        topicId: 'topic-1',
        name: 'Duplicate',
        description: null,
        createdAt: at,
      },
      expect: [],
      reject: { reason: 'Topic already exists' },
    },
  )
