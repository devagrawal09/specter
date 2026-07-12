import { createEventDefinition } from '@specter-ts/core'
import { z } from 'zod'

export const todoAddedEvent = createEventDefinition(
  'todo-added',
  z.object({
    todoId: z.string(),
    title: z.string(),
  }),
)

export const todoCompletionChangedEvent = createEventDefinition(
  'todo-completion-changed',
  z.object({
    todoId: z.string(),
    completed: z.boolean(),
  }),
)

export const todoRemovedEvent = createEventDefinition(
  'todo-removed',
  z.object({
    todoId: z.string(),
  }),
)

export const todoCheerCreatedEvent = createEventDefinition(
  'todo-cheer-created',
  z.object({
    milestone: z.number().int().positive(),
    message: z.string(),
  }),
)

export const todoEventDefinitions = [
  todoAddedEvent,
  todoCompletionChangedEvent,
  todoRemovedEvent,
  todoCheerCreatedEvent,
] as const

export type Event =
  | ReturnType<typeof todoAddedEvent.create>
  | ReturnType<typeof todoCompletionChangedEvent.create>
  | ReturnType<typeof todoRemovedEvent.create>
  | ReturnType<typeof todoCheerCreatedEvent.create>
