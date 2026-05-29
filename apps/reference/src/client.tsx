import { render } from '@solidjs/web'
import { defineSpecterClient } from '@specter-ts/core/client'

import './styles.css'
import { TodoApp } from './todo-app'

import type { todoSpecterAppConfig } from './features/todos/registry'

type TodoSpecterAppConfig = typeof todoSpecterAppConfig

export const specterClient = defineSpecterClient<TodoSpecterAppConfig>('/api')

const root = document.getElementById('app')

if (!root) {
  throw new Error('Missing app root')
}

render(() => <TodoApp />, root)
