import { describe, expect, it } from 'vitest'

import {
  createSpecterCodeApiRouter,
  implementedOpenCodeApiRoutes,
  type SpecterCodeApiRuntime,
} from './api-routes'
import type { RouteSpec } from './domain/openapi-compat'

async function json(response: Response) {
  return response.json() as Promise<unknown>
}

describe('Specter Code OpenCode TUI API routes', () => {
  it('declares the OpenCode-compatible TUI control and command routes', () => {
    expect(implementedOpenCodeApiRoutes).toEqual(
      expect.arrayContaining<RouteSpec>([
        { method: 'POST', normalizedPath: '/tui/append-prompt' },
        { method: 'POST', normalizedPath: '/tui/clear-prompt' },
        { method: 'POST', normalizedPath: '/tui/control/response' },
        { method: 'GET', normalizedPath: '/tui/control/next' },
        { method: 'POST', normalizedPath: '/tui/execute-command' },
        { method: 'POST', normalizedPath: '/tui/open-help' },
        { method: 'POST', normalizedPath: '/tui/open-models' },
        { method: 'POST', normalizedPath: '/tui/open-sessions' },
        { method: 'POST', normalizedPath: '/tui/open-themes' },
        { method: 'POST', normalizedPath: '/tui/publish' },
        { method: 'POST', normalizedPath: '/tui/select-session' },
        { method: 'POST', normalizedPath: '/tui/show-toast' },
        { method: 'POST', normalizedPath: '/tui/submit-prompt' },
      ]),
    )
  })

  it('dispatches TUI event routes and control queue routes to the runtime', async () => {
    const calls: string[] = []
    const runtime = {
      async publishTuiEvent(input: {
        workspaceRoot: string
        event: { type: string; properties: unknown }
      }) {
        calls.push(
          `publish:${input.workspaceRoot}:${input.event.type}:${JSON.stringify(input.event.properties)}`,
        )
        return true
      },
      async nextTuiControlRequest(input: { workspaceRoot: string }) {
        calls.push(`next:${input.workspaceRoot}`)
        return { path: '/tui/open-help', body: { source: 'keyboard' } }
      },
      async submitTuiControlResponse(input: {
        workspaceRoot: string
        response: unknown
      }) {
        calls.push(
          `response:${input.workspaceRoot}:${JSON.stringify(input.response)}`,
        )
        return true
      },
    } as SpecterCodeApiRuntime
    const router = createSpecterCodeApiRouter({ runtime })

    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/tui/append-prompt?directory=/repo', {
            method: 'POST',
            body: JSON.stringify({ text: 'hello' }),
          }),
        ),
      ),
    ).resolves.toBe(true)
    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/tui/open-help?directory=/repo', {
            method: 'POST',
          }),
        ),
      ),
    ).resolves.toBe(true)
    await expect(
      json(
        await router.handle(
          new Request(
            'http://specter.test/tui/execute-command?directory=/repo',
            {
              method: 'POST',
              body: JSON.stringify({ command: 'session_new' }),
            },
          ),
        ),
      ),
    ).resolves.toBe(true)
    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/tui/publish?directory=/repo', {
            method: 'POST',
            body: JSON.stringify({
              type: 'tui.toast.show',
              properties: { message: 'Saved', variant: 'success' },
            }),
          }),
        ),
      ),
    ).resolves.toBe(true)
    await expect(
      json(
        await router.handle(
          new Request('http://specter.test/tui/control/next?directory=/repo'),
        ),
      ),
    ).resolves.toEqual({ path: '/tui/open-help', body: { source: 'keyboard' } })
    await expect(
      json(
        await router.handle(
          new Request(
            'http://specter.test/tui/control/response?directory=/repo',
            {
              method: 'POST',
              body: JSON.stringify({ ok: true }),
            },
          ),
        ),
      ),
    ).resolves.toBe(true)

    expect(calls).toEqual([
      'publish:/repo:tui.prompt.append:{"text":"hello"}',
      'publish:/repo:tui.command.execute:{"command":"help.show"}',
      'publish:/repo:tui.command.execute:{"command":"session.new"}',
      'publish:/repo:tui.toast.show:{"message":"Saved","variant":"success"}',
      'next:/repo',
      'response:/repo:{"ok":true}',
    ])
  })
})
