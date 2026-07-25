import { render } from '@solidjs/web'

import { HARLAN_APP } from './app-model'

const root = document.getElementById('app')

if (!root) {
  throw new Error('Missing app root')
}

render(
  () => (
    <main>
      <p>Portable workflow runtime</p>
      <h1>{HARLAN_APP.name}</h1>
      <p>{HARLAN_APP.description}</p>
    </main>
  ),
  root,
)
