import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { createCommandSlice } from '../../registry.builders'
import { todoCheerCreatedEvent } from '../../shared'
import { todoCompletionStates } from '../change-todo-completion/slice'
import { todoCheerMilestoneStates } from '../todo-completion-cheer-reaction/slice'

export const createTodoCheerSliceRegistration = createCommandSlice(
  'createTodoCheer',
)
  .schema(
    z.object({
      milestone: z.number().int().positive(),
    }),
  )
  .decide((command, tx) => {
    if (command.milestone % 5 !== 0) {
      throw new Error('Todo cheer milestone must be a multiple of 5')
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

    if (completedCount < command.milestone) {
      throw new Error('Todo cheer milestone has not been reached')
    }

    const existingMilestone = tx
      .select()
      .from(todoCheerMilestoneStates)
      .where(eq(todoCheerMilestoneStates.milestone, command.milestone))
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
