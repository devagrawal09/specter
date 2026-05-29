import { defineSpecterClient } from '@specter-ts/core/client'

import type { todoSpecterAppConfig } from './features/todos/registry'

type TodoSpecterAppConfig = typeof todoSpecterAppConfig

export const specterClient = defineSpecterClient<TodoSpecterAppConfig>('/api')
