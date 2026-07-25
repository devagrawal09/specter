import { expect, test } from 'vitest'

import { lastLanternHost, lastLanternPort, lastLanternViteServer } from './port'

test('keeps Last Lantern on its fixed strict port', () => {
  expect(lastLanternHost).toBe('127.0.0.1')
  expect(lastLanternPort).toBe(41738)
  expect(lastLanternViteServer).toEqual({
    host: '127.0.0.1',
    port: 41738,
    strictPort: true,
  })
})
