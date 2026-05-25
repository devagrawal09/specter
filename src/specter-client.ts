import type { todoSpecterAppConfig } from './features/todos/registry'
import { createRpcSpecterClient } from './lib/client'

type TodoSpecterAppConfig = typeof todoSpecterAppConfig

export const specterClient = createRpcSpecterClient<TodoSpecterAppConfig>()
