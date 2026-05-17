import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import {
  applyEvents,
  commandInput,
  decideCommand,
  dispatchCommandInTx,
  sliceRegistrations,
} from './registry'
import {
  events,
  todoAddedEvent,
  todoCheerCreatedEvent,
  todoCompletionChangedEvent,
} from './shared'
import { createTestDb, storedEvent } from './shared/test-db'
import { todoCompletionStates } from './slices/change-todo-completion/slice'
import { todoRemovalStates } from './slices/remove-todo/slice'
import { todoCheers } from './slices/todo-cheers/slice'
import { todoCheerMilestoneStates } from './slices/todo-completion-cheer-reaction/slice'
import { todoListItems } from './slices/todos-view/slice'

describe('todo registry', () => {
  it('builds command input from registered command slices', () => {
    const commandPayloadByType = {
      addTodo: { title: 'Ship it' },
      changeTodoCompletion: { todoId: 'todo-1', completed: true },
      removeTodo: { todoId: 'todo-1' },
      createTodoCheer: { milestone: 5 },
    }
    const commandTypes = sliceRegistrations
      .filter((slice) => slice.kind === 'command')
      .map((slice) => slice.type)

    expect(commandTypes).toEqual(Object.keys(commandPayloadByType))

    for (const type of commandTypes) {
      const payload =
        commandPayloadByType[type as keyof typeof commandPayloadByType]

      expect(commandInput.safeParse({ type, payload }).success).toBe(true)
    }

    for (const slice of sliceRegistrations.filter(
      (registration) => registration.kind !== 'command',
    )) {
      expect(
        commandInput.safeParse({
          type: slice.name,
          payload: {},
        }).success,
      ).toBe(false)
    }
  })

  it('routes decisions by command type', () => {
    const { db, sqlite } = createTestDb()
    const [event] = decideCommand(
      {
        type: 'addTodo',
        payload: { title: 'Route me' },
      },
      db,
    )

    expect(event).toMatchObject({
      type: 'todoAdded',
      payload: { title: 'Route me' },
    })
    sqlite.close()
  })

  it('applies command state and projection state in registration order', () => {
    const { db, sqlite } = createTestDb()

    applyEvents(
      [
        storedEvent(
          todoAddedEvent.create({ todoId: 'todo-1', title: 'Ship it' }),
          1,
        ),
      ],
      db,
    )

    expect(
      db
        .select()
        .from(todoCompletionStates)
        .where(eq(todoCompletionStates.todoId, 'todo-1'))
        .get(),
    ).toMatchObject({ todoId: 'todo-1', lastAppliedEventId: 1 })
    expect(
      db
        .select()
        .from(todoRemovalStates)
        .where(eq(todoRemovalStates.todoId, 'todo-1'))
        .get(),
    ).toMatchObject({ todoId: 'todo-1', lastAppliedEventId: 1 })
    expect(
      db
        .select()
        .from(todoListItems)
        .where(eq(todoListItems.id, 'todo-1'))
        .get(),
    ).toMatchObject({ id: 'todo-1', title: 'Ship it', lastAppliedEventId: 1 })
    sqlite.close()
  })

  it('uses clean fluent registration shapes', () => {
    expect(sliceRegistrations.map((slice) => slice.kind)).toEqual([
      'command',
      'command',
      'command',
      'command',
      'reaction',
      'projection',
      'projection',
    ])
    expect(sliceRegistrations[0]).not.toHaveProperty('payload')
    expect(sliceRegistrations[0]).toHaveProperty('schema')
  })

  it('does not run reactions during replay-only applyEvents', () => {
    const { db, sqlite } = createTestDb()

    applyEvents(
      Array.from({ length: 5 }, (_, index) => {
        const todoId = `todo-${index + 1}`

        return [
          storedEvent(
            todoAddedEvent.create({ todoId, title: todoId }),
            index * 2 + 1,
          ),
          storedEvent(
            todoCompletionChangedEvent.create({ todoId, completed: true }),
            index * 2 + 2,
          ),
        ]
      }).flat(),
      db,
    )

    expect(db.select().from(todoCheerMilestoneStates).all()).toEqual([])
    expect(db.select().from(todoCheers).all()).toEqual([])
    sqlite.close()
  })

  it('dispatches reaction-created commands in the same transaction', () => {
    const { db, sqlite } = createTestDb()

    for (let index = 1; index <= 5; index += 1) {
      const [addedEvent] = dispatchCommandInTx(
        { type: 'addTodo', payload: { title: `Todo ${index}` } },
        db,
      )

      if (!todoAddedEvent.is(addedEvent)) {
        throw new Error(`Expected todoAdded, received ${addedEvent.type}`)
      }

      dispatchCommandInTx(
        {
          type: 'changeTodoCompletion',
          payload: { todoId: addedEvent.payload.todoId, completed: true },
        },
        db,
      )
    }

    expect(db.select().from(todoCheers).all()).toEqual([
      {
        milestone: 5,
        message: 'Nice work: 5 todos completed.',
        lastAppliedEventId: 11,
      },
    ])
    expect(db.select().from(events).all()).toHaveLength(11)
    sqlite.close()
  })

  it('applies persisted cheer events to reaction state and projection state', () => {
    const { db, sqlite } = createTestDb()

    applyEvents(
      [
        storedEvent(
          todoCheerCreatedEvent.create({
            milestone: 5,
            message: 'Nice work: 5 todos completed.',
          }),
          1,
        ),
      ],
      db,
    )

    expect(db.select().from(todoCheerMilestoneStates).all()).toEqual([
      { milestone: 5, lastAppliedEventId: 1 },
    ])
    expect(db.select().from(todoCheers).all()).toEqual([
      {
        milestone: 5,
        message: 'Nice work: 5 todos completed.',
        lastAppliedEventId: 1,
      },
    ])
    sqlite.close()
  })
})
