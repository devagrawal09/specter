import { and, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { z } from 'zod'
import { createCommandSlice } from '@specter-ts/core'
import { sqliteSliceStore } from '../../../db/specter-sqlite'
import {
  todoAddedEvent,
  todoCheerCreatedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
} from '../events'

export const createTodoCheerSqlTodoStates = sqliteTable(
  'create_todo_cheer_sql_todo_states',
  {
    todoId: text('todo_id').primaryKey(),
    completed: integer('completed', { mode: 'boolean' })
      .notNull()
      .default(false),
    removed: integer('removed', { mode: 'boolean' }).notNull().default(false),
  },
)

export const createTodoCheerSqlMilestoneStates = sqliteTable(
  'create_todo_cheer_sql_milestone_states',
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

const createTodoCheer = createCommandSlice(
  'createTodoCheer',
  'Creates milestone cheers for completed todos.',
)
  .schema(
    z.object({
      milestone: z.number().int().positive(),
    }),
  )
  .store(sqliteSliceStore)
  .scenarios(
    {
      description: 'Rejects a cheer milestone that is not a multiple of five.',
      given: [],
      when: { milestone: 4 },
      expect: [],
    },
    {
      description:
        'Rejects a cheer milestone before enough todos are completed.',
      given: completedTodoEvents(4),
      when: { milestone: 5 },
      expect: [],
    },
    {
      description: 'Rejects a cheer milestone that was already created.',
      given: [
        ...completedTodoEvents(5),
        todoCheerCreatedEvent.create({
          milestone: 5,
          message: 'Nice work: 5 todos completed.',
        }),
      ],
      when: { milestone: 5 },
      expect: [],
    },
    {
      description:
        'Creates a cheer when the completed todo count reaches a milestone.',
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
      description:
        'Rejects a cheer milestone when a completed todo was removed.',
      given: [
        ...completedTodoEvents(5),
        todoRemovedEvent.create({ todoId: 'todo-5' }),
      ],
      when: { milestone: 5 },
      expect: [],
    },
  )
  .apply({
    [todoAddedEvent.type]: async (event, input) => {
      const db = input
      const payload = await todoAddedEvent.decode(event.payload)

      await db
        .insert(createTodoCheerSqlTodoStates)
        .values({
          todoId: payload.todoId,
          completed: false,
          removed: false,
        })
        .run()
    },
    [todoCompletionChangedEvent.type]: async (event, input) => {
      const db = input
      const payload = await todoCompletionChangedEvent.decode(event.payload)

      await db
        .update(createTodoCheerSqlTodoStates)
        .set({ completed: payload.completed })
        .where(eq(createTodoCheerSqlTodoStates.todoId, payload.todoId))
        .run()
    },
    [todoRemovedEvent.type]: async (event, input) => {
      const db = input
      const payload = await todoRemovedEvent.decode(event.payload)

      await db
        .update(createTodoCheerSqlTodoStates)
        .set({ removed: true })
        .where(eq(createTodoCheerSqlTodoStates.todoId, payload.todoId))
        .run()
    },
    [todoCheerCreatedEvent.type]: async (event, input) => {
      const db = input
      const payload = await todoCheerCreatedEvent.decode(event.payload)

      await db
        .insert(createTodoCheerSqlMilestoneStates)
        .values({ milestone: payload.milestone })
        .run()
    },
  })
  .handle(async (command, db) => {
    if (command.milestone % 5 !== 0) {
      throw new Error('Todo cheer milestone must be a multiple of 5')
    }

    const completedTodos = await db
      .select()
      .from(createTodoCheerSqlTodoStates)
      .where(
        and(
          eq(createTodoCheerSqlTodoStates.completed, true),
          eq(createTodoCheerSqlTodoStates.removed, false),
        ),
      )
      .all()
    const completedCount = completedTodos.length

    if (completedCount < command.milestone) {
      throw new Error('Todo cheer milestone has not been reached')
    }

    const existingMilestones = await db
      .select()
      .from(createTodoCheerSqlMilestoneStates)
      .where(eq(createTodoCheerSqlMilestoneStates.milestone, command.milestone))
      .all()

    if (existingMilestones[0]) {
      throw new Error('Todo cheer milestone already exists')
    }

    return [
      todoCheerCreatedEvent.create({
        milestone: command.milestone,
        message: `Nice work: ${command.milestone} todos completed.`,
      }),
    ]
  })

export default createTodoCheer
