import z from 'zod'
import { createEventSpec } from '../../lib'

export const todoAddedEvent = createEventSpec(
  'todoAdded',
  z.object({
    todoId: z.string(),
    title: z.string(),
  }),
)

export const todoCompletionChangedEvent = createEventSpec(
  'todoCompletionChanged',
  z.object({
    todoId: z.string(),
    completed: z.boolean(),
  }),
)

export const todoRemovedEvent = createEventSpec(
  'todoRemoved',
  z.object({
    todoId: z.string(),
  }),
)

export const todoCheerCreatedEvent = createEventSpec(
  'todoCheerCreated',
  z.object({
    milestone: z.number().int().positive(),
    message: z.string(),
  }),
)

export const errorEvent = createEventSpec(
  'error',
  z.object({
    message: z.string(),
  }),
)

export type Event =
  | ReturnType<typeof todoAddedEvent.create>
  | ReturnType<typeof todoCompletionChangedEvent.create>
  | ReturnType<typeof todoRemovedEvent.create>
  | ReturnType<typeof todoCheerCreatedEvent.create>
  | ReturnType<typeof errorEvent.create>
