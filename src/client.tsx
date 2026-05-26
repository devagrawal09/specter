import { render } from '@solidjs/web'

import './styles.css'
import { AppRouter } from './landing-pages'
import { SpecterClientProvider } from './lib/view-runtime'
import { specterClient } from './specter-client'

const root = document.getElementById('app')

if (!root) {
  throw new Error('Missing app root')
}

render(
  () => (
    <SpecterClientProvider client={specterClient}>
      <AppRouter />
    </SpecterClientProvider>
  ),
  root,
)
