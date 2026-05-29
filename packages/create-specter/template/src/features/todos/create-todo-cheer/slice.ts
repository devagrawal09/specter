import { and, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import * as Schema from 'effect/Schema'
import { createCommandSlice, rejectCommand } from '@specter-ts/core'
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

const createTodoCheerSql = createCommandSlice('createTodoCheer')
  .schema(
    Schema.Struct({
      milestone: Schema.Number.pipe(Schema.int(), Schema.positive()),
    }),
  )
  .store(sqliteSliceStore)
  .scenarios(
    {
      given: [],
      when: { milestone: 4 },
      expect: [],
    },
    {
      given: completedTodoEvents(4),
      when: { milestone: 5 },
      expect: [],
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
      expect: [],
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
      expect: [],
    },
  )
  .apply({
    [todoAddedEvent.type]: async (event, input) => {
      const db = input
      const payload = todoAddedEvent.decode(event.payload)

      db.insert(createTodoCheerSqlTodoStates)
        .values({
          todoId: payload.todoId,
          completed: false,
          removed: false,
        })
        .run()
    },
    [todoCompletionChangedEvent.type]: async (event, input) => {
      const db = input
      const payload = todoCompletionChangedEvent.decode(event.payload)

      db.update(createTodoCheerSqlTodoStates)
        .set({ completed: payload.completed })
        .where(eq(createTodoCheerSqlTodoStates.todoId, payload.todoId))
        .run()
    },
    [todoRemovedEvent.type]: async (event, input) => {
      const db = input
      const payload = todoRemovedEvent.decode(event.payload)

      db.update(createTodoCheerSqlTodoStates)
        .set({ removed: true })
        .where(eq(createTodoCheerSqlTodoStates.todoId, payload.todoId))
        .run()
    },
    [todoCheerCreatedEvent.type]: async (event, input) => {
      const db = input
      const payload = todoCheerCreatedEvent.decode(event.payload)

      db.insert(createTodoCheerSqlMilestoneStates)
        .values({ milestone: payload.milestone })
        .run()
    },
  })
  .handle(async (command, db) => {
    if (command.milestone % 5 !== 0) {
      rejectCommand('Todo cheer milestone must be a multiple of 5')
    }

    const completedTodos = db
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
      rejectCommand('Todo cheer milestone has not been reached')
    }

    const existingMilestones = db
      .select()
      .from(createTodoCheerSqlMilestoneStates)
      .where(eq(createTodoCheerSqlMilestoneStates.milestone, command.milestone))
      .all()

    if (existingMilestones[0]) {
      rejectCommand('Todo cheer milestone already exists')
    }

    return [
      todoCheerCreatedEvent.create({
        milestone: command.milestone,
        message: `Nice work: ${command.milestone} todos completed.`,
      }),
    ]
  })

export default createTodoCheerSql
