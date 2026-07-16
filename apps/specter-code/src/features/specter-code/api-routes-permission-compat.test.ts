import { describe, expect, it } from 'vitest'

import {
  createOpenCodeCompatibilityReport,
  type RouteSpec,
} from './domain/openapi-compat'
import {
  createSpecterCodeApiRouter,
  implementedOpenCodeApiRoutes,
  type SpecterCodeApiRuntime,
} from './api-routes'

function createPermissionRuntime() {
  const calls: string[] = []
  const runtime = new Proxy(
    {
      calls,
      async replyPermission(input: {
        requestId: string
        sessionId: string
        action: 'allow' | 'deny'
        repliedBy?: { userId?: string; displayName: string }
        reason?: string
      }) {
        calls.push(
          `replyPermission:${input.requestId}:${input.sessionId}:${input.action}:${input.repliedBy?.displayName ?? ''}:${input.reason ?? ''}`,
        )
        return { requestId: input.requestId, action: input.action }
      },
    },
    {
      get(target, prop: string | symbol) {
        if (prop in target) return target[prop as keyof typeof target]
        return async () => {
          throw new Error(`Unexpected runtime call: ${String(prop)}`)
        }
      },
    },
  ) as SpecterCodeApiRuntime & { calls: string[] }
  return runtime
}

async function json(response: Response) {
  expect(response.status).toBe(200)
  return response.json()
}

const sessionPermissionRoute: RouteSpec = {
  method: 'POST',
  normalizedPath: '/session/:sessionID/permissions/:permissionID',
}

describe('OpenCode deprecated session permission response route', () => {
  it('declares the session-scoped permission response route in the implemented inventory', () => {
    const report = createOpenCodeCompatibilityReport({
      openCodeRoutes: [
        {
          ...sessionPermissionRoute,
          openApiPath: '/session/{sessionID}/permissions/{permissionID}',
          operationId: 'permission.respond',
        },
      ],
      implementedRoutes: implementedOpenCodeApiRoutes,
      requiredRoutes: [sessionPermissionRoute],
    })

    expect(report.summary).toEqual({ required: 1, matched: 1, missing: 0 })
    expect(report.matched[0]).toEqual(
      expect.objectContaining({
        key: 'POST /session/:sessionID/permissions/:permissionID',
        openApiPath: '/session/{sessionID}/permissions/{permissionID}',
      }),
    )
  })

  it('maps OpenCode once permission responses to Specter Code allow decisions', async () => {
    const runtime = createPermissionRuntime()
    const router = createSpecterCodeApiRouter({ runtime })

    await expect(
      json(
        await router.handle(
          new Request(
            'http://specter.test/session/session-main/permissions/permission-1',
            {
              method: 'POST',
              body: JSON.stringify({ response: 'once' }),
            },
          ),
        ),
      ),
    ).resolves.toEqual({ requestId: 'permission-1', action: 'allow' })

    expect(runtime.calls).toEqual([
      'replyPermission:permission-1:session-main:allow:OpenCode API:OpenCode permission response: once',
    ])
  })

  it('maps OpenCode reject permission responses to Specter Code deny decisions', async () => {
    const runtime = createPermissionRuntime()
    const router = createSpecterCodeApiRouter({ runtime })

    await expect(
      json(
        await router.handle(
          new Request(
            'http://specter.test/session/session-main/permissions/permission-2',
            {
              method: 'POST',
              body: JSON.stringify({ response: 'reject' }),
            },
          ),
        ),
      ),
    ).resolves.toEqual({ requestId: 'permission-2', action: 'deny' })

    expect(runtime.calls).toEqual([
      'replyPermission:permission-2:session-main:deny:OpenCode API:OpenCode permission response: reject',
    ])
  })
})
