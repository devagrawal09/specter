import type { ToolDefinition } from '../adapters/tool-registry'

export type TodoStatus = 'pending' | 'in_progress' | 'completed'
export type TodoPriority = 'low' | 'medium' | 'high'

export type TodoToolInputItem = {
  id?: string
  content: string
  status: string
  priority?: TodoPriority
}

export type TodoToolOutputItem = {
  id: string
  content: string
  status: TodoStatus
  priority?: TodoPriority
}

export type TodoToolInput = {
  items: TodoToolInputItem[]
}

export type TodoToolOutput = {
  sessionId: string
  messageId: string
  items: TodoToolOutputItem[]
}

const TODO_STATUSES = new Set<TodoStatus>(['pending', 'in_progress', 'completed'])

function normalizeTodoItem(item: TodoToolInputItem): TodoToolOutputItem {
  const content = item.content.trim()
  if (!content) throw new Error('Todo content is required')
  if (!TODO_STATUSES.has(item.status as TodoStatus)) {
    throw new Error('Unsupported todo status: ' + item.status)
  }

  return {
    id: item.id ?? crypto.randomUUID(),
    content,
    status: item.status as TodoStatus,
    priority: item.priority,
  }
}

function plural(count: number, singular: string, pluralName = singular + 's') {
  return count + ' ' + (count === 1 ? singular : pluralName)
}

function summarize(items: readonly TodoToolOutputItem[]) {
  const pending = items.filter((item) => item.status === 'pending').length
  const inProgress = items.filter((item) => item.status === 'in_progress').length
  const completed = items.filter((item) => item.status === 'completed').length
  return (
    'Updated ' +
    plural(items.length, 'todo') +
    ' (' +
    plural(pending, 'pending', 'pending') +
    ', ' +
    plural(inProgress, 'in progress', 'in progress') +
    ', ' +
    plural(completed, 'completed', 'completed') +
    ')'
  )
}

export const todoTool: ToolDefinition<TodoToolInput, TodoToolOutput> = {
  name: 'todo',
  description: 'Update the current session todo list',
  permission: 'todo.write',
  async execute(input, context) {
    const items = input.items.map(normalizeTodoItem)

    await context.metadata({
      toolName: 'todo',
      status: 'completed',
      summary: summarize(items),
    })

    return {
      sessionId: context.sessionId,
      messageId: context.messageId,
      items,
    }
  },
}
