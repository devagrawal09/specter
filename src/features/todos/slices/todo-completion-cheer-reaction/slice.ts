import { and, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { createReactionSlice } from '../../registry.builders'
import { todoCheerCreatedEvent, todoCompletionChangedEvent } from '../../shared'
import { todoCompletionStates } from '../change-todo-completion/slice'

export const todoCheerMilestoneStates = sqliteTable(
  'todo_cheer_milestone_states',
  {
    milestone: integer('milestone').primaryKey(),
    lastAppliedEventId: text('last_applied_event_id').notNull(),
  },
)

export const todoCompletionCheerReactionSliceRegistration = createReactionSlice(
  'todoCompletionCheer',
)
  .apply((event, tx) => {
    if (!todoCheerCreatedEvent.is(event)) {
      return
    }

    tx.insert(todoCheerMilestoneStates)
      .values({
        milestone: event.payload.milestone,
        lastAppliedEventId: event.id,
      })
      .run()
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
      .from(todoCompletionStates)
      .where(
        and(
          eq(todoCompletionStates.completed, true),
          eq(todoCompletionStates.removed, false),
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
