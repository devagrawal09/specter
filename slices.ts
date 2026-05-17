export type Event = {};

export type ProjectionState<S> = (events: Event[]) => S
export type ProjectionView<P, S, O> = (state: S, params: P) => O
export type Projection<P, O> = (events: Event[], params: P) => O

export type CommandState<S> = (events: Event[]) => S
export type CommandHandler<C, S> = (state: S, command: C) => Event[]
export type Command<C> = (events: Event[], command: C) => Event[]

export type ReactionState<S> = (events: Event[]) => S
export type ReactionHandler<S> = (state: S) => Command<any>[]
export type Reaction = (events: Event[]) => Command<any>[]

export type Effect = {}

export type TranslationOutState<S> = (events: Event[]) => S
export type TranslationOutHandler<S> = (state: S) => Effect[]
export type TranslationOut = (events: Event[]) => Effect[]

export type TranslationInState<S> = (events: Effect[]) => S
export type TranslationInHandler<S> = (state: S) => Event[]
export type TranslationIn = (effects: Effect[]) => Event[]

// todoAddedEvent
// todoRemovedEvent
// todoCompletedEvent

// todosProjection
// addTodoCommand
// removeTodoCommand
// completeTodoCommand

// todoAddedReaction
// todoRemovedReaction
// todoCompletedReaction