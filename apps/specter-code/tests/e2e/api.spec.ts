import { expect, test } from '@playwright/test'

test('serves OpenCode-compatible provider, agent, config, and event endpoints over HTTP', async ({ request }) => {
  const providers = await request.get('/provider')
  expect(providers.status()).toBe(200)
  expect(providers.headers()['content-type']).toContain('application/json')
  expect(await providers.json()).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: 'openrouter' })]),
  )

  const agents = await request.get('/agent')
  expect(agents.status()).toBe(200)
  expect(agents.headers()['content-type']).toContain('application/json')
  expect(await agents.json()).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: 'build' })]),
  )

  const workspaceRoot = process.cwd()
  const config = await request.get(`/config?workspaceRoot=${encodeURIComponent(workspaceRoot)}`)
  expect(config.status()).toBe(200)
  expect(config.headers()['content-type']).toContain('application/json')
  expect(await config.json()).toEqual(
    expect.objectContaining({
      sources: expect.any(Array),
      permissionRules: expect.any(Array),
      raw: expect.any(Object),
    }),
  )

  const events = await request.get('/event?after=0&live=false')
  expect(events.status()).toBe(200)
  expect(events.headers()['content-type']).toContain('text/event-stream')
})
