import { createQuerySlice, event } from '@specter-ts/spec'

const journalAt = '2026-07-18T15:00:00.000Z'
const taskAt = '2026-07-18T16:00:00.000Z'
const topicAt = '2026-07-18T17:00:00.000Z'
const connectionAt = '2026-07-18T18:00:00.000Z'
const changedAt = '2026-07-18T19:00:00.000Z'

export const gardenQuerySpec = createQuerySlice('gardenQuery')
  .description(
    'Returns the permanent score as a read-only garden built from Worklog events.',
  )
  .scenarios(
    {
      description:
        'Rebuilds edited, restored records and their permanent milestone growth.',
      given: [
        event('journal-entry-added', {
          journalEntryId: 'journal-1',
          body: 'Original note',
          activityAt: journalAt,
          createdAt: journalAt,
        }),
        event('journal-entry-edited', {
          journalEntryId: 'journal-1',
          body: 'Edited note',
          activityAt: journalAt,
          editedAt: changedAt,
        }),
        event('journal-entry-archive-changed', {
          journalEntryId: 'journal-1',
          archived: true,
          changedAt,
        }),
        event('journal-entry-archive-changed', {
          journalEntryId: 'journal-1',
          archived: false,
          changedAt,
        }),
        event('task-added', {
          taskId: 'task-1',
          title: 'Original task',
          notes: null,
          dueAt: null,
          createdAt: taskAt,
        }),
        event('task-edited', {
          taskId: 'task-1',
          title: 'Edited task',
          notes: 'Task notes',
          dueAt: null,
          editedAt: changedAt,
        }),
        event('task-completion-changed', {
          taskId: 'task-1',
          completed: true,
          changedAt,
        }),
        event('task-completion-changed', {
          taskId: 'task-1',
          completed: false,
          changedAt,
        }),
        event('task-archive-changed', {
          taskId: 'task-1',
          archived: true,
          changedAt,
        }),
        event('task-archive-changed', {
          taskId: 'task-1',
          archived: false,
          changedAt,
        }),
        event('topic-added', {
          topicId: 'topic-1',
          name: 'Original topic',
          description: null,
          createdAt: topicAt,
        }),
        event('topic-edited', {
          topicId: 'topic-1',
          name: 'Edited topic',
          description: 'Topic notes',
          editedAt: changedAt,
        }),
        event('topic-archive-changed', {
          topicId: 'topic-1',
          archived: true,
          changedAt,
        }),
        event('topic-archive-changed', {
          topicId: 'topic-1',
          archived: false,
          changedAt,
        }),
        event('records-connected', {
          connectionId: 'connection-1',
          left: { kind: 'task', id: 'task-1' },
          right: { kind: 'topic', id: 'topic-1' },
          connectedAt: connectionAt,
        }),
        event('connection-archive-changed', {
          connectionId: 'connection-1',
          archived: true,
          changedAt,
        }),
        event('connection-archive-changed', {
          connectionId: 'connection-1',
          archived: false,
          changedAt,
        }),
        event('point-awarded', {
          awardKey: 'journal:journal-1:created',
          reason: 'journal-added',
          points: 1,
          subject: { kind: 'journal', id: 'journal-1' },
          related: [],
          awardedAt: journalAt,
        }),
        event('point-awarded', {
          awardKey: 'task:task-1:created',
          reason: 'task-added',
          points: 1,
          subject: { kind: 'task', id: 'task-1' },
          related: [],
          awardedAt: taskAt,
        }),
        event('point-awarded', {
          awardKey: 'topic:topic-1:created',
          reason: 'topic-added',
          points: 1,
          subject: { kind: 'topic', id: 'topic-1' },
          related: [],
          awardedAt: topicAt,
        }),
        event('point-awarded', {
          awardKey: 'connection:connection-1:created',
          reason: 'connection-added',
          points: 1,
          subject: { kind: 'connection', id: 'connection-1' },
          related: [
            { kind: 'task', id: 'task-1' },
            { kind: 'topic', id: 'topic-1' },
          ],
          awardedAt: connectionAt,
        }),
        event('point-awarded', {
          awardKey: 'task:task-1:first-completion',
          reason: 'task-first-completed',
          points: 1,
          subject: { kind: 'task', id: 'task-1' },
          related: [],
          awardedAt: changedAt,
        }),
        event('point-awarded', {
          awardKey: 'connection:connection-1:completed-task',
          reason: 'completed-task-connection',
          points: 1,
          subject: { kind: 'task', id: 'task-1' },
          related: [{ kind: 'topic', id: 'topic-1' }],
          awardedAt: changedAt,
        }),
        event('point-awarded', {
          awardKey: 'topic:topic-1:all-tasks-completed',
          reason: 'topic-all-tasks-completed',
          points: 1,
          subject: { kind: 'topic', id: 'topic-1' },
          related: [{ kind: 'task', id: 'task-1' }],
          awardedAt: changedAt,
        }),
      ],
      when: {},
      expect: {
        totalPoints: 7,
        records: [
          {
            id: 'journal-1',
            kind: 'journal',
            label: 'Edited note',
            detail: 'Edited note',
            createdAt: journalAt,
            archived: false,
            effects: [],
          },
          {
            id: 'task-1',
            kind: 'task',
            label: 'Edited task',
            detail: 'Task notes',
            createdAt: taskAt,
            archived: false,
            effects: [{ reason: 'task-first-completed', awardedAt: changedAt }],
          },
          {
            id: 'topic-1',
            kind: 'topic',
            label: 'Edited topic',
            detail: 'Topic notes',
            createdAt: topicAt,
            archived: false,
            effects: [
              { reason: 'topic-all-tasks-completed', awardedAt: changedAt },
            ],
          },
        ],
        connections: [
          {
            id: 'connection-1',
            left: { kind: 'task', id: 'task-1' },
            right: { kind: 'topic', id: 'topic-1' },
            connectedAt: connectionAt,
            archived: false,
            effects: [
              { reason: 'completed-task-connection', awardedAt: changedAt },
            ],
          },
        ],
      },
    },
    {
      description: 'Omits records that never received their creation point.',
      given: [
        event('task-added', {
          taskId: 'task-without-award',
          title: 'Not planted',
          notes: null,
          dueAt: null,
          createdAt: taskAt,
        }),
      ],
      when: {},
      expect: { totalPoints: 0, records: [], connections: [] },
    },
  )

export default gardenQuerySpec
