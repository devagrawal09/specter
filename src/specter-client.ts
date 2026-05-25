import { api } from './api-client'
import type { todoSpecterAppConfig } from './features/todos/registry'
import { createHttpSpecterClient } from './lib/client'

type TodoSpecterAppConfig = typeof todoSpecterAppConfig

export const specterClient = createHttpSpecterClient<TodoSpecterAppConfig>(api)
