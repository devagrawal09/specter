import type { todoSpecterAppConfig } from './features/todos/registry'
import { createRpcSpecterClient } from '@specter-ts/core/client'

type TodoSpecterAppConfig = typeof todoSpecterAppConfig

export const specterClient = createRpcSpecterClient<TodoSpecterAppConfig>()
