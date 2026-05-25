import { render } from '@solidjs/web'

import './styles.css'
import { SpecterClientProvider } from './lib/view-runtime'
import { TodoApp } from './todo-app'
import { todoSpecterClient } from './todo-specter-client'

const root = document.getElementById('app')

if (!root) {
  throw new Error('Missing app root')
}

render(
  () => (
    <SpecterClientProvider client={todoSpecterClient}>
      <TodoApp />
    </SpecterClientProvider>
  ),
  root,
)
