import { render } from '@solidjs/web'

import './styles.css'
import { SpecterClientProvider } from './lib/view-runtime'
import { specterClient } from './specter-client'
import { TodoApp } from './todo-app'

const root = document.getElementById('app')

if (!root) {
  throw new Error('Missing app root')
}

render(
  () => (
    <SpecterClientProvider client={specterClient}>
      <TodoApp />
    </SpecterClientProvider>
  ),
  root,
)
