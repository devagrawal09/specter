// @vitest-environment jsdom

import { expect, it, vi } from 'vitest'

vi.mock('solid-js/web', () => ({
  render: (_component: unknown, root: HTMLElement) => {
    if (root.childElementCount !== 0)
      throw new Error('Dashboard root was not cleared before rendering.')
    const shell = document.createElement('div')
    shell.className = 'shell'
    root.append(shell)
  },
}))

it('removes the loading placeholder before rendering the dashboard', async () => {
  document.head.innerHTML = '<meta name="specter-base" content="">'
  document.body.innerHTML =
    '<div id="app"><main class="empty">Loading Specter dashboard…</main></div>'

  await import('./dashboard')

  const root = document.getElementById('app')
  expect(root?.querySelector(':scope > .empty')).toBeNull()
  expect(root?.querySelector(':scope > .shell')).not.toBeNull()
})
