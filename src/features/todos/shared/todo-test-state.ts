import type { TodoSnapshot } from './todo-types'

export function todoSnapshot(
  overrides: Partial<TodoSnapshot> = {},
): TodoSnapshot {
  return {
    id: 'todo-1',
    title: 'Ship it',
    completed: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    removedAt: null,
    ...overrides,
  }
}
