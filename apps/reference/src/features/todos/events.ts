import * as Schema from 'effect/Schema'
import { createEventDefinition } from '@specter/core'

export const todoAddedEvent = createEventDefinition(
  'todoAdded',
  Schema.Struct({
    todoId: Schema.String,
    title: Schema.String,
  }),
)

export const todoCompletionChangedEvent = createEventDefinition(
  'todoCompletionChanged',
  Schema.Struct({
    todoId: Schema.String,
    completed: Schema.Boolean,
  }),
)

export const todoRemovedEvent = createEventDefinition(
  'todoRemoved',
  Schema.Struct({
    todoId: Schema.String,
  }),
)

export const todoCheerCreatedEvent = createEventDefinition(
  'todoCheerCreated',
  Schema.Struct({
    milestone: Schema.Number.pipe(Schema.int(), Schema.positive()),
    message: Schema.String,
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
