import { createCommandSlice, event } from '@specter-ts/core/spec'

const at = '2026-07-18T15:00:00.000Z'
const task = (id: string) =>
  event('task-added', {
    taskId: id,
    title: id,
    notes: null,
    dueAt: null,
    createdAt: at,
  })

export const changeTaskCompletionSpec = createCommandSlice(
  'changeTaskCompletion',
)
  .description(
    'Completes or reopens a task and awards completion milestones once.',
  )
  .scenarios(
    {
      description:
        'Completes the third task in a topic and awards all applicable points.',
      given: [
        task('task-1'),
        task('task-2'),
        task('task-3'),
        event('topic-added', {
          topicId: 'topic-1',
          name: 'Topic',
          description: null,
          createdAt: at,
        }),
        event('task-completion-changed', {
          taskId: 'task-1',
          completed: true,
          changedAt: at,
        }),
        event('task-completion-changed', {
          taskId: 'task-2',
          completed: true,
          changedAt: at,
        }),
        event('records-connected', {
          connectionId: 'connection-1',
          left: { kind: 'task', id: 'task-1' },
          right: { kind: 'topic', id: 'topic-1' },
          connectedAt: at,
        }),
        event('records-connected', {
          connectionId: 'connection-2',
          left: { kind: 'task', id: 'task-2' },
          right: { kind: 'topic', id: 'topic-1' },
          connectedAt: at,
        }),
        event('records-connected', {
          connectionId: 'connection-3',
          left: { kind: 'task', id: 'task-3' },
          right: { kind: 'topic', id: 'topic-1' },
          connectedAt: at,
        }),
      ],
      when: { taskId: 'task-3', completed: true, changedAt: at },
      expect: [
        event('task-completion-changed', {
          taskId: 'task-3',
          completed: true,
          changedAt: at,
        }),
        event('point-awarded', {
          awardKey: 'task:task-3:first-completion',
          reason: 'task-first-completed',
          points: 1,
          subject: { kind: 'task', id: 'task-3' },
          related: [],
          awardedAt: at,
        }),
        event('point-awarded', {
          awardKey: 'connection:connection-3:completed-task',
          reason: 'completed-task-connection',
          points: 1,
          subject: { kind: 'task', id: 'task-3' },
          related: [{ kind: 'topic', id: 'topic-1' }],
          awardedAt: at,
        }),
        event('point-awarded', {
          awardKey: 'topic:topic-1:all-tasks-completed',
          reason: 'topic-all-tasks-completed',
          points: 1,
          subject: { kind: 'topic', id: 'topic-1' },
          related: [
            { kind: 'task', id: 'task-1' },
            { kind: 'task', id: 'task-2' },
            { kind: 'task', id: 'task-3' },
          ],
          awardedAt: at,
        }),
      ],
    },
    {
      description:
        'Recompletes a reopened task without repeating its completion point.',
      given: [
        task('task-1'),
        event('task-completion-changed', {
          taskId: 'task-1',
          completed: true,
          changedAt: at,
        }),
        event('point-awarded', {
          awardKey: 'task:task-1:first-completion',
          reason: 'task-first-completed',
          points: 1,
          subject: { kind: 'task', id: 'task-1' },
          related: [],
          awardedAt: at,
        }),
        event('task-completion-changed', {
          taskId: 'task-1',
          completed: false,
          changedAt: at,
        }),
      ],
      when: { taskId: 'task-1', completed: true, changedAt: at },
      expect: [
        event('task-completion-changed', {
          taskId: 'task-1',
          completed: true,
          changedAt: at,
        }),
      ],
    },
    {
      description:
        'Ignores archived connections and topics when awarding completion points.',
      given: [
        task('task-1'),
        event('topic-added', {
          topicId: 'topic-1',
          name: 'Topic',
          description: null,
          createdAt: at,
        }),
        event('records-connected', {
          connectionId: 'connection-1',
          left: { kind: 'task', id: 'task-1' },
          right: { kind: 'topic', id: 'topic-1' },
          connectedAt: at,
        }),
        event('connection-archive-changed', {
          connectionId: 'connection-1',
          archived: true,
          changedAt: at,
        }),
        event('topic-archive-changed', {
          topicId: 'topic-1',
          archived: true,
          changedAt: at,
        }),
      ],
      when: { taskId: 'task-1', completed: true, changedAt: at },
      expect: [
        event('task-completion-changed', {
          taskId: 'task-1',
          completed: true,
          changedAt: at,
        }),
        event('point-awarded', {
          awardKey: 'task:task-1:first-completion',
          reason: 'task-first-completed',
          points: 1,
          subject: { kind: 'task', id: 'task-1' },
          related: [],
          awardedAt: at,
        }),
      ],
    },
    {
      description: 'Rejects completing an archived task.',
      given: [
        task('task-1'),
        event('task-archive-changed', {
          taskId: 'task-1',
          archived: true,
          changedAt: at,
        }),
      ],
      when: { taskId: 'task-1', completed: true, changedAt: at },
      expect: [],
      reject: { reason: 'Task not found' },
    },
  )
