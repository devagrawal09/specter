import { createCommandSlice, event } from '@specter-ts/spec'

const at = '2026-07-18T15:00:00.000Z'

export const editTopicSpec = createCommandSlice('editTopic')
  .description('Edits the name or description of a topic.')
  .scenarios(
    {
      description: 'Edits an active topic.',
      given: [
        event('topic-added', {
          topicId: 'topic-1',
          name: 'Draft',
          description: null,
          createdAt: at,
        }),
      ],
      when: {
        topicId: 'topic-1',
        name: 'Final',
        description: 'Details',
        editedAt: at,
      },
      expect: [
        event('topic-edited', {
          topicId: 'topic-1',
          name: 'Final',
          description: 'Details',
          editedAt: at,
        }),
      ],
    },
    {
      description: 'Edits a previously edited topic.',
      given: [
        event('topic-added', {
          topicId: 'topic-1',
          name: 'Draft',
          description: null,
          createdAt: at,
        }),
        event('topic-edited', {
          topicId: 'topic-1',
          name: 'Middle',
          description: null,
          editedAt: at,
        }),
      ],
      when: {
        topicId: 'topic-1',
        name: 'Final',
        description: null,
        editedAt: at,
      },
      expect: [
        event('topic-edited', {
          topicId: 'topic-1',
          name: 'Final',
          description: null,
          editedAt: at,
        }),
      ],
    },
    {
      description: 'Rejects editing an archived topic.',
      given: [
        event('topic-added', {
          topicId: 'topic-1',
          name: 'Draft',
          description: null,
          createdAt: at,
        }),
        event('topic-archive-changed', {
          topicId: 'topic-1',
          archived: true,
          changedAt: at,
        }),
      ],
      when: {
        topicId: 'topic-1',
        name: 'Final',
        description: null,
        editedAt: at,
      },
      expect: [],
      reject: { reason: 'Topic not found' },
    },
  )

export default editTopicSpec
