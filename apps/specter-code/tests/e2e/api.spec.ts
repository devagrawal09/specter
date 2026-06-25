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

  const findFiles = await request.get(
    `/find/file?directory=${encodeURIComponent(workspaceRoot)}&query=api-routes.ts&limit=5`,
  )
  expect(findFiles.status()).toBe(200)
  expect(await findFiles.json()).toEqual(
    expect.arrayContaining(['src/features/specter-code/api-routes.ts']),
  )

  const findText = await request.get(
    `/find?directory=${encodeURIComponent(workspaceRoot)}&pattern=workspaceRootFromFindQuery&limit=5`,
  )
  expect(findText.status()).toBe(200)
  expect(await findText.json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: { text: 'src/features/specter-code/api-routes.ts' },
      }),
    ]),
  )

  const vcsStatus = await request.get(`/vcs/status?workspaceRoot=${encodeURIComponent(workspaceRoot)}`)
  expect(vcsStatus.status()).toBe(200)
  expect(vcsStatus.headers()['content-type']).toContain('application/json')
  expect(await vcsStatus.json()).toEqual(
    expect.objectContaining({
      clean: expect.any(Boolean),
      entries: expect.any(Array),
    }),
  )

  const vcsDiff = await request.get(`/vcs/diff?workspaceRoot=${encodeURIComponent(workspaceRoot)}`)
  expect(vcsDiff.status()).toBe(200)
  expect(vcsDiff.headers()['content-type']).toContain('application/json')
  expect(await vcsDiff.json()).toEqual(
    expect.objectContaining({
      patch: expect.any(String),
      staged: false,
    }),
  )

  const events = await request.get('/event?after=0&live=false')
  expect(events.status()).toBe(200)
  expect(events.headers()['content-type']).toContain('text/event-stream')
})
