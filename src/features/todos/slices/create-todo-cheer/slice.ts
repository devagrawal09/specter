import { and, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createCommandSpec } from '../../registry.builders'
import {
  errorEvent,
  todoAddedEvent,
  todoCheerCreatedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../../shared/events'

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

function completedTodoEvents(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const todoId = `todo-${index + 1}`

    return [
      todoAddedEvent.create({ todoId, title: todoId }),
      todoCompletionChangedEvent.create({ todoId, completed: true }),
    ]
  }).flat()
}

export const createTodoCheerSliceRegistration = createCommandSpec(
  'createTodoCheer',
)
  .schema(
    z.object({
      milestone: z.number().int().positive(),
    }),
  )
  .scenarios(
    {
      given: [],
      when: { milestone: 4 },
      expect: [
        errorEvent.create({
          message: 'Todo cheer milestone must be a multiple of 5',
        }),
      ],
    },
    {
      given: completedTodoEvents(4),
      when: { milestone: 5 },
      expect: [
        errorEvent.create({
          message: 'Todo cheer milestone has not been reached',
        }),
      ],
    },
    {
      given: [
        ...completedTodoEvents(5),
        todoCheerCreatedEvent.create({
          milestone: 5,
          message: 'Nice work: 5 todos completed.',
        }),
      ],
      when: { milestone: 5 },
      expect: [
        errorEvent.create({
          message: 'Todo cheer milestone already exists',
        }),
      ],
    },
    {
      given: completedTodoEvents(5),
      when: { milestone: 5 },
      expect: [
        todoCheerCreatedEvent.create({
          milestone: 5,
          message: 'Nice work: 5 todos completed.',
        }),
      ],
    },
    {
      given: [
        ...completedTodoEvents(5),
        todoRemovedEvent.create({ todoId: 'todo-5' }),
      ],
      when: { milestone: 5 },
      expect: [
        errorEvent.create({
          message: 'Todo cheer milestone has not been reached',
        }),
      ],
    },
  )
  .apply({
    [todoAddedEvent.type]: (event, tx) => {
      tx.insert(createTodoCheerTodoStates)
        .values({
          todoId: event.payload.todoId,
          completed: false,
          removed: false,
        })
        .run()
    },
    [todoCompletionChangedEvent.type]: (event, tx) => {
      tx.update(createTodoCheerTodoStates)
        .set({
          completed: event.payload.completed,
        })
        .where(eq(createTodoCheerTodoStates.todoId, event.payload.todoId))
        .run()
    },
    [todoRemovedEvent.type]: (event, tx) => {
      tx.update(createTodoCheerTodoStates)
        .set({
          removed: true,
        })
        .where(eq(createTodoCheerTodoStates.todoId, event.payload.todoId))
        .run()
    },
    [todoCheerCreatedEvent.type]: (event, tx) => {
      tx.insert(createTodoCheerMilestoneStates)
        .values({
          milestone: event.payload.milestone,
        })
        .run()
    },
  })
  .decide((command, tx) => {
    if (command.milestone % 5 !== 0) {
      return [
        errorEvent.create({
          message: 'Todo cheer milestone must be a multiple of 5',
        }),
      ]
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
      return [
        errorEvent.create({
          message: 'Todo cheer milestone has not been reached',
        }),
      ]
    }

    const existingMilestone = tx
      .select()
      .from(createTodoCheerMilestoneStates)
      .where(eq(createTodoCheerMilestoneStates.milestone, command.milestone))
      .get()

    if (existingMilestone) {
      return [
        errorEvent.create({
          message: 'Todo cheer milestone already exists',
        }),
      ]
    }

    return [
      todoCheerCreatedEvent.create({
        milestone: command.milestone,
        message: `Nice work: ${command.milestone} todos completed.`,
      }),
    ]
  })
