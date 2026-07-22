import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createSpecterObservabilityHttpHandler } from '../dist/index.js'

test('the built package serves the emitted dashboard bundle', async () => {
  const handler = createSpecterObservabilityHttpHandler({ collector: {} })
  const response = await handler(
    new Request('http://collector.test/dashboard.js'),
  )

  assert.equal(response.status, 200)
  assert.equal(
    response.headers.get('content-type'),
    'text/javascript; charset=utf-8',
  )

  const source = await response.text()
  assert.ok(source.length > 1_000)
  assert.match(source, /Specter dashboard root is missing/)
})
