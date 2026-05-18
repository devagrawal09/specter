import { and, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createReactionSpec } from '../../registry.builders'
import {
  todoAddedEvent,
  todoCheerCreatedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
  type Event,
} from '../../shared'

export const todoCompletionCheerTodoStates = sqliteTable(
  'todo_completion_cheer_todo_states',
  {
    todoId: text('todo_id').primaryKey(),
    completed: integer('completed', { mode: 'boolean' })
      .notNull()
      .default(false),
    removed: integer('removed', { mode: 'boolean' }).notNull().default(false),
  },
)

export const todoCheerMilestoneStates = sqliteTable(
  'todo_cheer_milestone_states',
  {
    milestone: integer('milestone').primaryKey(),
  },
)

function completedTodoEvents(count: number): Event[] {
  return Array.from({ length: count }, (_, index) => {
    const todoId = `todo-${index + 1}`

    return [
      todoAddedEvent.create({ todoId, title: todoId }),
      todoCompletionChangedEvent.create({ todoId, completed: true }),
    ]
  }).flat()
}

export const todoCompletionCheerReactionSliceRegistration = createReactionSpec(
  'todoCompletionCheer',
)
  .apply({
    [todoAddedEvent.type]: (event, tx) => {
      tx.insert(todoCompletionCheerTodoStates)
        .values({
          todoId: event.payload.todoId,
          completed: false,
          removed: false,
        })
        .run()
    },
    [todoCompletionChangedEvent.type]: (event, tx) => {
      tx.update(todoCompletionCheerTodoStates)
        .set({
          completed: event.payload.completed,
        })
        .where(eq(todoCompletionCheerTodoStates.todoId, event.payload.todoId))
        .run()
    },
    [todoRemovedEvent.type]: (event, tx) => {
      tx.update(todoCompletionCheerTodoStates)
        .set({
          removed: true,
        })
        .where(eq(todoCompletionCheerTodoStates.todoId, event.payload.todoId))
        .run()
    },
    [todoCheerCreatedEvent.type]: (event, tx) => {
      tx.insert(todoCheerMilestoneStates)
        .values({
          milestone: event.payload.milestone,
        })
        .run()
    },
  })
  .scenarios(
    {
      given: completedTodoEvents(4),
      when: todoCompletionChangedEvent.create({
        todoId: 'todo-4',
        completed: true,
      }),
      expect: [],
    },
    {
      given: completedTodoEvents(5),
      when: todoCompletionChangedEvent.create({
        todoId: 'todo-5',
        completed: true,
      }),
      expect: [{ type: 'createTodoCheer', payload: { milestone: 5 } }],
    },
    {
      given: [
        ...completedTodoEvents(5),
        todoCheerCreatedEvent.create({
          milestone: 5,
          message: 'Nice work: 5 todos completed.',
        }),
        todoCompletionChangedEvent.create({
          todoId: 'todo-5',
          completed: false,
        }),
        todoCompletionChangedEvent.create({
          todoId: 'todo-5',
          completed: true,
        }),
      ],
      when: todoCompletionChangedEvent.create({
        todoId: 'todo-5',
        completed: true,
      }),
      expect: [],
    },
    {
      given: [
        ...completedTodoEvents(5),
        todoCheerCreatedEvent.create({
          milestone: 5,
          message: 'Nice work: 5 todos completed.',
        }),
        todoRemovedEvent.create({ todoId: 'todo-5' }),
      ],
      when: todoCompletionChangedEvent.create({
        todoId: 'todo-4',
        completed: true,
      }),
      expect: [],
    },
  )
  .react((event, tx) => {
    if (
      !todoCompletionChangedEvent.is(event) ||
      event.payload.completed !== true
    ) {
      return []
    }

    const completedCount = tx
      .select()
      .from(todoCompletionCheerTodoStates)
      .where(
        and(
          eq(todoCompletionCheerTodoStates.completed, true),
          eq(todoCompletionCheerTodoStates.removed, false),
        ),
      )
      .all().length

    if (completedCount === 0 || completedCount % 5 !== 0) {
      return []
    }

    const existingMilestone = tx
      .select()
      .from(todoCheerMilestoneStates)
      .where(eq(todoCheerMilestoneStates.milestone, completedCount))
      .get()

    if (existingMilestone) {
      return []
    }

    return [
      {
        type: 'createTodoCheer',
        payload: { milestone: completedCount },
      },
    ]
  })
