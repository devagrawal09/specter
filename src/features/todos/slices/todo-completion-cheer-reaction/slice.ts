import { and, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createReactionSpec } from '../../registry.builders'
import {
  todoAddedEvent,
  todoCheerCreatedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
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

export const todoCompletionCheerReactionSliceRegistration = createReactionSpec(
  'todoCompletionCheer',
)
  .apply((event, tx) => {
    if (todoAddedEvent.is(event)) {
      tx.insert(todoCompletionCheerTodoStates)
        .values({
          todoId: event.payload.todoId,
          completed: false,
          removed: false,
        })
        .run()
    }

    if (todoCompletionChangedEvent.is(event)) {
      tx.update(todoCompletionCheerTodoStates)
        .set({
          completed: event.payload.completed,
        })
        .where(eq(todoCompletionCheerTodoStates.todoId, event.payload.todoId))
        .run()
    }

    if (todoRemovedEvent.is(event)) {
      tx.update(todoCompletionCheerTodoStates)
        .set({
          removed: true,
        })
        .where(eq(todoCompletionCheerTodoStates.todoId, event.payload.todoId))
        .run()
    }

    if (todoCheerCreatedEvent.is(event)) {
      tx.insert(todoCheerMilestoneStates)
        .values({
          milestone: event.payload.milestone,
        })
        .run()
    }
  })
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
