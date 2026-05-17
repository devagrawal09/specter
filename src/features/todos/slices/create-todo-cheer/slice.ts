import { and, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createCommandSpec } from '../../registry.builders'
import {
  todoAddedEvent,
  todoCheerCreatedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../../shared'

export const createTodoCheerTodoStates = sqliteTable(
  'create_todo_cheer_todo_states',
  {
    todoId: text('todo_id').primaryKey(),
    completed: integer('completed', { mode: 'boolean' })
      .notNull()
      .default(false),
    removed: integer('removed', { mode: 'boolean' }).notNull().default(false),
  },
)

export const createTodoCheerMilestoneStates = sqliteTable(
  'create_todo_cheer_milestone_states',
  {
    milestone: integer('milestone').primaryKey(),
  },
)

export const createTodoCheerSliceRegistration = createCommandSpec(
  'createTodoCheer',
)
  .schema(
    z.object({
      milestone: z.number().int().positive(),
    }),
  )
  .apply((event, tx) => {
    if (todoAddedEvent.is(event)) {
      tx.insert(createTodoCheerTodoStates)
        .values({
          todoId: event.payload.todoId,
          completed: false,
          removed: false,
        })
        .run()
    }

    if (todoCompletionChangedEvent.is(event)) {
      tx.update(createTodoCheerTodoStates)
        .set({
          completed: event.payload.completed,
        })
        .where(eq(createTodoCheerTodoStates.todoId, event.payload.todoId))
        .run()
    }

    if (todoRemovedEvent.is(event)) {
      tx.update(createTodoCheerTodoStates)
        .set({
          removed: true,
        })
        .where(eq(createTodoCheerTodoStates.todoId, event.payload.todoId))
        .run()
    }

    if (todoCheerCreatedEvent.is(event)) {
      tx.insert(createTodoCheerMilestoneStates)
        .values({
          milestone: event.payload.milestone,
        })
        .run()
    }
  })
  .decide((command, tx) => {
    if (command.milestone % 5 !== 0) {
      throw new Error('Todo cheer milestone must be a multiple of 5')
    }

    const completedCount = tx
      .select()
      .from(createTodoCheerTodoStates)
      .where(
        and(
          eq(createTodoCheerTodoStates.completed, true),
          eq(createTodoCheerTodoStates.removed, false),
        ),
      )
      .all().length

    if (completedCount < command.milestone) {
      throw new Error('Todo cheer milestone has not been reached')
    }

    const existingMilestone = tx
      .select()
      .from(createTodoCheerMilestoneStates)
      .where(eq(createTodoCheerMilestoneStates.milestone, command.milestone))
      .get()

    if (existingMilestone) {
      throw new Error('Todo cheer milestone already exists')
    }

    return [
      todoCheerCreatedEvent.create({
        milestone: command.milestone,
        message: `Nice work: ${command.milestone} todos completed.`,
      }),
    ]
  })
