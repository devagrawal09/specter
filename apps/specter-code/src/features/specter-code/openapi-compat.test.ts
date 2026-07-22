import path from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createOpenCodeCompatibilityReport,
  loadOpenCodeRouteInventory,
  type RouteSpec,
} from './domain/openapi-compat'

let fixtureDirectory: string
let openCodeOpenApiPath: string

beforeAll(async () => {
  fixtureDirectory = await mkdtemp(path.join(tmpdir(), 'opencode-openapi-'))
  openCodeOpenApiPath = path.join(fixtureDirectory, 'openapi.json')
  await writeFile(
    openCodeOpenApiPath,
    JSON.stringify({
      paths: {
        '/session': { get: {}, post: {} },
        '/session/{sessionID}/prompt_async': { post: {} },
        '/permission/{requestID}/reply': { post: {} },
        '/file/content': { get: {} },
        '/session/{sessionID}/message/{messageID}/part/{partID}': { patch: {} },
      },
    }),
  )
})

afterAll(() => rm(fixtureDirectory, { recursive: true, force: true }))

describe('OpenCode route compatibility inventory', () => {
  it('loads the local OpenCode OpenAPI document into normalized HTTP route specs', async () => {
    const inventory = await loadOpenCodeRouteInventory({
      openApiPath: openCodeOpenApiPath,
    })

    expect(inventory.source).toBe(openCodeOpenApiPath)
    expect(inventory.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'GET',
          openApiPath: '/session',
          normalizedPath: '/session',
        }),
        expect.objectContaining({
          method: 'POST',
          openApiPath: '/session/{sessionID}/prompt_async',
          normalizedPath: '/session/:sessionID/prompt_async',
        }),
        expect.objectContaining({
          method: 'POST',
          openApiPath: '/permission/{requestID}/reply',
          normalizedPath: '/permission/:requestID/reply',
        }),
        expect.objectContaining({
          method: 'GET',
          openApiPath: '/file/content',
          normalizedPath: '/file/content',
        }),
      ]),
    )
    expect(inventory.routes.map((route) => route.key)).toContain(
      'PATCH /session/:sessionID/message/:messageID/part/:partID',
    )
  })

  it('reports matched and missing Specter Code routes against a required OpenCode subset', async () => {
    const inventory = await loadOpenCodeRouteInventory({
      openApiPath: openCodeOpenApiPath,
    })
    const implementedRoutes: RouteSpec[] = [
      { method: 'GET', normalizedPath: '/session' },
      { method: 'POST', normalizedPath: '/session' },
      { method: 'GET', normalizedPath: '/file/content' },
    ]
    const requiredRoutes: RouteSpec[] = [
      { method: 'GET', normalizedPath: '/session' },
      { method: 'POST', normalizedPath: '/session' },
      { method: 'GET', normalizedPath: '/file/content' },
      { method: 'POST', normalizedPath: '/permission/:requestID/reply' },
    ]

    const report = createOpenCodeCompatibilityReport({
      openCodeRoutes: inventory.routes,
      implementedRoutes,
      requiredRoutes,
    })

    expect(report.summary).toEqual({ required: 4, matched: 3, missing: 1 })
    expect(report.matched.map((route) => route.key)).toEqual([
      'GET /session',
      'POST /session',
      'GET /file/content',
    ])
    expect(report.missing).toEqual([
      expect.objectContaining({
        key: 'POST /permission/:requestID/reply',
        openApiPath: '/permission/{requestID}/reply',
      }),
    ])
  })
})
