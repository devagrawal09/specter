export type TodoEvent =
  | {
      type: 'todoAdded'
      payload: { todoId: string; title: string; createdAt: string }
    }
  | {
      type: 'todoCompletionChanged'
      payload: { todoId: string; completed: boolean; updatedAt: string }
    }
  | {
      type: 'todoRemoved'
      payload: { todoId: string; removedAt: string }
    }
