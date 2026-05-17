import { eq } from 'drizzle-orm'
import { describe, expect } from 'vitest'

import {
  todoAddedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../../shared'
import { projectionScenario } from '../../shared/test-scenario'
import { todoListItems, todosViewQueryInput } from './slice'

describe('showing todos', () => {
  projectionScenario(
    'given a todo was added, completed, and removed, when the todo list is shown, then it shows the latest todo state',
  )
    .given(
      todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
      todoCompletionChangedEvent.create({
        todoId: 'todo-1',
        completed: true,
      }),
      todoRemovedEvent.create({ todoId: 'todo-1' }),
    )
    .when(({ db }) =>
      db
        .select()
        .from(todoListItems)
        .where(eq(todoListItems.id, 'todo-1'))
        .get(),
    )
    .expect((row) => {
      expect(row).toMatchObject({
        id: 'todo-1',
        title: 'Ship it',
        completed: true,
      })
      expect(row?.removed).toBe(true)
    })

  projectionScenario(
    'given a todo list filter in the URL, when the filter is read, then unknown filters fall back to all todos',
  )
    .given({ status: 'active' }, { status: 'wat' }, {})
    .when(({ given }) =>
      given.map((search) => todosViewQueryInput.parse(search)),
    )
    .expect(([active, unknown, empty]) => {
      expect(active).toEqual({ status: 'active' })
      expect(unknown).toEqual({ status: 'all' })
      expect(empty).toEqual({ status: 'all' })
    })
})
