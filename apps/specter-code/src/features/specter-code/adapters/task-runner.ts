export type TaskExecutorInput = {
  taskId: string
  sessionId: string
  messageId: string
  parentAgent: string
  agent: string
  description?: string
  prompt: string
  workspaceRoot: string
  abortSignal?: AbortSignal
}

export type TaskExecutorResult = {
  summary: string
  output?: string
  data?: unknown
}

export type TaskStatus = 'running' | 'completed' | 'failed'

export type TaskRecord = {
  taskId: string
  sessionId: string
  messageId: string
  parentAgent: string
  agent: string
  description?: string
  prompt: string
  workspaceRoot: string
  status: TaskStatus
  startedAt: string
  completedAt?: string
  result?: TaskExecutorResult
  error?: string
}

export type TaskExecutor = (input: TaskExecutorInput) => Promise<TaskExecutorResult> | TaskExecutorResult

export type CreateTaskRunnerOptions = {
  execute: TaskExecutor
  now?: () => Date
}

export type TaskRunner = ReturnType<typeof createTaskRunner>

export function createTaskRunner(options: CreateTaskRunnerOptions) {
  const tasks = new Map<string, TaskRecord>()
  const now = () => (options.now ?? (() => new Date()))().toISOString()

  async function runTask(input: TaskExecutorInput, record: TaskRecord) {
    try {
      const result = await options.execute(input)
      record.status = 'completed'
      record.completedAt = now()
      record.result = result
    } catch (error) {
      record.status = 'failed'
      record.completedAt = now()
      record.error = error instanceof Error ? error.message : String(error)
    }
  }

  return {
    spawn(input: TaskExecutorInput) {
      if (tasks.has(input.taskId)) throw new Error('Task already exists: ' + input.taskId)

      const record: TaskRecord = {
        ...input,
        status: 'running',
        startedAt: now(),
      }
      tasks.set(input.taskId, record)
      void runTask(input, record)
      return record
    },

    getTask(taskId: string) {
      return tasks.get(taskId)
    },

    listTasks() {
      return [...tasks.values()]
    },
  }
}
