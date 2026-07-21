import { render } from '@solidjs/web'

import './styles.css'
import { WorklogApp } from './worklog-app'

const root = document.getElementById('app')

if (!root) {
  throw new Error('Missing app root')
}

render(() => <WorklogApp />, root)
