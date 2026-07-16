import { readFile } from 'node:fs/promises'

const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'patch',
  'options',
  'head',
  'trace',
] as const

type OpenApiHttpMethod = (typeof HTTP_METHODS)[number]
export type HttpMethod = Uppercase<OpenApiHttpMethod>

export type RouteSpec = {
  method: HttpMethod
  normalizedPath: string
  openApiPath?: string
  operationId?: string
  tags?: string[]
  key?: string
}

export type OpenCodeRouteInventory = {
  source: string
  routes: RouteSpec[]
}

export type OpenCodeCompatibilityReport = {
  summary: {
    required: number
    matched: number
    missing: number
  }
  matched: RouteSpec[]
  missing: RouteSpec[]
}

type OpenApiOperation = {
  operationId?: unknown
  tags?: unknown
}

type OpenApiDocument = {
  paths?: Record<string, Record<string, OpenApiOperation | unknown>>
}

export async function loadOpenCodeRouteInventory(input: {
  openApiPath: string
}): Promise<OpenCodeRouteInventory> {
  const raw = await readFile(input.openApiPath, 'utf8')
  const document = JSON.parse(raw) as OpenApiDocument
  return {
    source: input.openApiPath,
    routes: extractOpenCodeRoutes(document),
  }
}

export function extractOpenCodeRoutes(document: OpenApiDocument): RouteSpec[] {
  return Object.entries(document.paths ?? {})
    .flatMap(([openApiPath, operations]) =>
      HTTP_METHODS.flatMap((method) => {
        const operation = operations[method]
        if (!operation) return []
        const normalizedPath = normalizeOpenApiPath(openApiPath)
        return [
          withRouteKey({
            method: method.toUpperCase() as HttpMethod,
            openApiPath,
            normalizedPath,
            operationId: readString(
              (operation as OpenApiOperation).operationId,
            ),
            tags: readStringArray((operation as OpenApiOperation).tags),
          }),
        ]
      }),
    )
    .sort(compareRoutes)
}

export function normalizeOpenApiPath(openApiPath: string) {
  return openApiPath.replace(/\{([^}/]+)\}/g, ':$1')
}

export function createOpenCodeCompatibilityReport(input: {
  openCodeRoutes: readonly RouteSpec[]
  implementedRoutes: readonly RouteSpec[]
  requiredRoutes: readonly RouteSpec[]
}): OpenCodeCompatibilityReport {
  const openCodeByKey = new Map(
    input.openCodeRoutes.map((route) => [withRouteKey(route).key, route]),
  )
  const implementedKeys = new Set(
    input.implementedRoutes.map((route) => withRouteKey(route).key),
  )

  const required = input.requiredRoutes.map((route) => {
    const keyedRoute = withRouteKey(route)
    return withRouteKey({
      ...keyedRoute,
      ...openCodeByKey.get(keyedRoute.key),
    })
  })

  const matched = required.filter((route) => implementedKeys.has(route.key))
  const missing = required.filter((route) => !implementedKeys.has(route.key))

  return {
    summary: {
      required: required.length,
      matched: matched.length,
      missing: missing.length,
    },
    matched,
    missing,
  }
}

function withRouteKey(route: RouteSpec): RouteSpec & { key: string } {
  return {
    ...route,
    key: `${route.method} ${route.normalizedPath}`,
  }
}

function readString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readStringArray(value: unknown) {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === 'string')
    ? value
    : undefined
}

function compareRoutes(left: RouteSpec, right: RouteSpec) {
  return `${left.normalizedPath} ${left.method}`.localeCompare(
    `${right.normalizedPath} ${right.method}`,
  )
}
