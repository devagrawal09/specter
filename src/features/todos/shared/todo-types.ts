export type Todo = {
  id: string
  title: string
  completed: boolean
  createdAt: string
  updatedAt: string
}

export type TodoSnapshot = Todo & {
  removedAt: string | null
}

export type TodoStatusFilter = 'all' | 'active' | 'completed'

export type TodosView = {
  todos: Todo[]
  activeCount: number
  completedCount: number
  totalCount: number
}

export function parseTodoStatusFilter(value: unknown): TodoStatusFilter {
  return value === 'active' || value === 'completed' ? value : 'all'
}
