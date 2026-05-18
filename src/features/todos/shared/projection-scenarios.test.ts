import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { applyEvents, sliceRegistrations } from '../registry'
import type {
  ProjectionScenario,
  ProjectionUiAssertion,
} from '../registry.builders'
import {
  latestTodoCheerOrder,
  todoCheers,
} from '../slices/todo-cheers/slice'
import {
  todoListItems,
  type TodoStatusFilter,
} from '../slices/todos-view/slice'
import type { StoreTx } from './index'
import { createTestDb } from './test-db'

describe('todo projection scenarios', () => {
  for (const registration of sliceRegistrations) {
    if (registration.kind !== 'projection' || !registration.scenarios) {
      continue
    }

    const projectionName = registration.name
    const scenarios = registration.scenarios

    describe(projectionName, () => {
      for (const scenario of scenarios) {
        it(scenarioLabel(scenario), () => {
          const { db, sqlite } = createTestDb()

          try {
            applyEvents([...scenario.given], db)

            const projectionInput = registration.schema.parse(scenario.when)
            const result = projectUiShape(
              registration.name,
              projectionInput,
              db,
            )

            assertUi(result, scenario.expect)
          } finally {
            sqlite.close()
          }
        })
      }
    })
  }
})

function scenarioLabel(scenario: ProjectionScenario) {
  return [
    `given ${scenario.given.length} event(s)`,
    'when projection input is applied',
    'then expected UI shape is returned',
  ].join(', ')
}

function projectUiShape(
  projectionName: string,
  projectionInput: unknown,
  tx: StoreTx,
): ProjectionUiAssertion {
  if (projectionName === 'todosView') {
    return projectTodosViewUiShape(
      tx,
      projectionInput as { status: TodoStatusFilter },
    )
  }

  if (projectionName === 'todoCheers') {
    return projectTodoCheersUiShape(tx)
  }

  throw new Error(`Unknown todo projection scenario: ${projectionName}`)
}

function projectTodosViewUiShape(
  tx: StoreTx,
  input: { status: TodoStatusFilter },
): ProjectionUiAssertion {
  const visiblePredicate = eq(todoListItems.removed, false)

  const statusPredicate =
    input.status === 'active'
      ? and(visiblePredicate, eq(todoListItems.completed, false))
      : input.status === 'completed'
        ? and(visiblePredicate, eq(todoListItems.completed, true))
        : visiblePredicate

  const todos = tx.select().from(todoListItems).where(statusPredicate).all()
  const activeCount = todos.filter((todo) => !todo.completed).length
  const completedCount = todos.filter((todo) => todo.completed).length
  const text: Record<string, string> = {
    'todo-summary': `${todos.length} total · ${activeCount} active · ${completedCount} completed`,
  }

  for (const todo of todos) {
    text[`todo-title-${todo.id}`] = todo.title
  }

  if (todos.length === 0) {
    text['empty-message'] = emptyTodosMessage(input.status)
  }

  return {
    visible: todos.length > 0 ? ['todo-list'] : ['empty-state'],
    hidden: todos.length > 0 ? ['empty-state'] : ['todo-list'],
    text,
    count: {
      'todo-item': todos.length,
    },
  }
}

function projectTodoCheersUiShape(tx: StoreTx): ProjectionUiAssertion {
  const latestCheer = tx
    .select()
    .from(todoCheers)
    .orderBy(latestTodoCheerOrder)
    .limit(1)
    .get()

  if (!latestCheer) {
    return {
      hidden: ['todo-cheer'],
    }
  }

  return {
    visible: ['todo-cheer'],
    text: {
      'todo-cheer': latestCheer.message,
    },
  }
}

function emptyTodosMessage(status: TodoStatusFilter) {
  if (status === 'active') {
    return 'No active todos.'
  }

  if (status === 'completed') {
    return 'No completed todos.'
  }

  return 'No todos yet.'
}

function assertUi(
  actual: ProjectionUiAssertion,
  expected: ProjectionUiAssertion,
) {
  if (expected.visible) {
    expect(actual.visible ?? []).toEqual(
      expect.arrayContaining([...expected.visible]),
    )
  }

  if (expected.hidden) {
    for (const testId of expected.hidden) {
      expect(actual.visible ?? []).not.toContain(testId)
      expect(actual.text ?? {}).not.toHaveProperty(testId)
    }
  }

  if (expected.text) {
    expect(actual.text ?? {}).toMatchObject(expected.text)
  }

  if (expected.count) {
    expect(actual.count ?? {}).toMatchObject(expected.count)
  }
}
