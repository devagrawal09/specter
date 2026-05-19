import { render } from '@solidjs/web'

import './styles.css'
import { TodoApp } from './todo-app'

const root = document.getElementById('app')

if (!root) {
  throw new Error('Missing app root')
}

render(() => <TodoApp />, root)
