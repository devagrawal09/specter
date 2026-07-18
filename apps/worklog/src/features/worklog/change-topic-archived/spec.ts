import { createCommandSlice, event } from '@specter-ts/core/spec'

const at = '2026-07-18T15:00:00.000Z'

export const changeTopicArchivedSpec = createCommandSlice('changeTopicArchived')
  .description('Archives or restores a topic without deleting its history.')
  .scenarios(
    {
      description: 'Archives an active topic.',
      given: [
        event('topic-added', {
          topicId: 'topic-1',
          name: 'Topic',
          description: null,
          createdAt: at,
        }),
      ],
      when: { topicId: 'topic-1', archived: true, changedAt: at },
      expect: [
        event('topic-archive-changed', {
          topicId: 'topic-1',
          archived: true,
          changedAt: at,
        }),
      ],
    },
    {
      description: 'Restores an edited archived topic.',
      given: [
        event('topic-added', {
          topicId: 'topic-1',
          name: 'Topic',
          description: null,
          createdAt: at,
        }),
        event('topic-edited', {
          topicId: 'topic-1',
          name: 'Edited',
          description: null,
          editedAt: at,
        }),
        event('topic-archive-changed', {
          topicId: 'topic-1',
          archived: true,
          changedAt: at,
        }),
      ],
      when: { topicId: 'topic-1', archived: false, changedAt: at },
      expect: [
        event('topic-archive-changed', {
          topicId: 'topic-1',
          archived: false,
          changedAt: at,
        }),
      ],
    },
  )
