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

export type AddTodoCommand = { title: string }
export type ChangeTodoCompletionCommand = {
  todoId: string
  completed: boolean
}
export type RemoveTodoCommand = { todoId: string }

export type Todo = {
  id: string
  title: string
  completed: boolean
  createdAt: string
  updatedAt: string
}

export type TodoStatusFilter = 'all' | 'active' | 'completed'

export type TodosView = {
  todos: Todo[]
  activeCount: number
  completedCount: number
  totalCount: number
}

export type TodoSnapshot = Todo & {
  removedAt: string | null
}

const maxTitleLength = 120

export function parseTodoStatusFilter(value: unknown): TodoStatusFilter {
  return value === 'active' || value === 'completed' ? value : 'all'
}

export function validateTodoTitle(title: string) {
  const normalizedTitle = title.trim()

  if (!normalizedTitle) {
    throw new Error('Todo title is required')
  }

  if (normalizedTitle.length > maxTitleLength) {
    throw new Error(`Todo title must be ${maxTitleLength} characters or less`)
  }

  return normalizedTitle
}

export function projectTodoState(events: TodoEvent[]): TodoSnapshot[] {
  const todosById = new Map<string, TodoSnapshot>()

  for (const event of events) {
    if (event.type === 'todoAdded') {
      todosById.set(event.payload.todoId, {
        id: event.payload.todoId,
        title: event.payload.title,
        completed: false,
        createdAt: event.payload.createdAt,
        updatedAt: event.payload.createdAt,
        removedAt: null,
      })
    }

    if (event.type === 'todoCompletionChanged') {
      const todo = todosById.get(event.payload.todoId)

      if (todo) {
        todosById.set(todo.id, {
          ...todo,
          completed: event.payload.completed,
          updatedAt: event.payload.updatedAt,
        })
      }
    }

    if (event.type === 'todoRemoved') {
      const todo = todosById.get(event.payload.todoId)

      if (todo) {
        todosById.set(todo.id, {
          ...todo,
          updatedAt: event.payload.removedAt,
          removedAt: event.payload.removedAt,
        })
      }
    }
  }

  return Array.from(todosById.values())
}

export function projectTodos(
  events: TodoEvent[],
  status: TodoStatusFilter = 'all',
): TodosView {
  return createTodosView(projectTodoState(events), status)
}

export function createTodosView(
  snapshots: TodoSnapshot[],
  status: TodoStatusFilter = 'all',
): TodosView {
  const visibleTodos = snapshots.filter((todo) => !todo.removedAt)
  const activeCount = visibleTodos.filter((todo) => !todo.completed).length
  const completedCount = visibleTodos.filter((todo) => todo.completed).length

  const filteredTodos = visibleTodos
    .filter((todo) => {
      if (status === 'active') {
        return !todo.completed
      }

      if (status === 'completed') {
        return todo.completed
      }

      return true
    })
    .sort((left, right) => {
      if (status === 'all' && left.completed !== right.completed) {
        return Number(left.completed) - Number(right.completed)
      }

      return (
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      )
    })
    .map(({ removedAt: _removedAt, ...todo }) => todo)

  return {
    todos: filteredTodos,
    activeCount,
    completedCount,
    totalCount: visibleTodos.length,
  }
}

export function handleAddTodo(
  command: AddTodoCommand,
  now = new Date(),
  todoId = crypto.randomUUID(),
): TodoEvent[] {
  const title = validateTodoTitle(command.title)

  return [
    {
      type: 'todoAdded',
      payload: { todoId, title, createdAt: now.toISOString() },
    },
  ]
}

export function handleChangeTodoCompletion(
  state: TodoSnapshot[],
  command: ChangeTodoCompletionCommand,
  now = new Date(),
): TodoEvent[] {
  const todo = state.find((candidate) => candidate.id === command.todoId)

  if (!todo || todo.removedAt) {
    throw new Error('Todo not found')
  }

  if (todo.completed === command.completed) {
    return []
  }

  return [
    {
      type: 'todoCompletionChanged',
      payload: {
        todoId: command.todoId,
        completed: command.completed,
        updatedAt: now.toISOString(),
      },
    },
  ]
}

export function handleRemoveTodo(
  state: TodoSnapshot[],
  command: RemoveTodoCommand,
  now = new Date(),
): TodoEvent[] {
  const todo = state.find((candidate) => candidate.id === command.todoId)

  if (!todo || todo.removedAt) {
    throw new Error('Todo not found')
  }

  return [
    {
      type: 'todoRemoved',
      payload: { todoId: command.todoId, removedAt: now.toISOString() },
    },
  ]
}
