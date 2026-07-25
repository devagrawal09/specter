import { describe, expect, it } from 'vitest'

import {
  canonicalDashboardLocation,
  dashboardSearch,
  defaultDashboardLocation,
  parseDashboardLocation,
  scenarioTabIndexForKey,
} from './dashboard-navigation'

describe('dashboard URL state', () => {
  it('defaults to the application home', () => {
    expect(parseDashboardLocation('')).toEqual(defaultDashboardLocation)
  })

  it('round-trips a scoped guided scenario view', () => {
    const state = {
      view: 'slice' as const,
      application: 'todo reference',
      environment: 'development',
      digest: 'sha256:abc',
      scenario: 2,
      source: 'typescript\u00000.4.0\u0000instance-1\u0000todo-log',
      search: 'todo added',
      guidedStage: 2 as const,
    }

    expect(parseDashboardLocation(dashboardSearch(state))).toEqual(state)
  })

  it('opens old digest links in the Slice view and rejects invalid indices', () => {
    expect(
      parseDashboardLocation('?digest=sha256%3Aabc&scenario=-1&stage=9'),
    ).toMatchObject({
      view: 'slice',
      digest: 'sha256:abc',
      scenario: 0,
      guidedStage: 0,
    })
  })

  it('canonicalizes mismatched scope, source, and scenario state', () => {
    const specification = {
      digest: 'sha256:abc' as const,
      document: {
        $schema:
          'https://specter.dev/specification/v1/slice.schema.json' as const,
        formatVersion: 1 as const,
        kind: 'query' as const,
        name: 'todosQuery',
        description: 'Lists todos.',
        scenarios: [
          { description: 'Lists none.', given: [], when: {}, expect: [] },
          { description: 'Lists one.', given: [], when: {}, expect: [{}] },
        ],
      },
      firstPublishedAt: '2026-07-22T12:00:00.000Z',
      sources: [
        {
          application: 'todo',
          environment: 'production',
          runtimeLanguage: 'typescript',
          runtimeVersion: '0.4.0',
          instanceId: 'instance-1',
          eventLogId: 'todo-log',
        },
      ],
    }

    expect(
      canonicalDashboardLocation(
        {
          view: 'slice',
          application: 'wrong',
          environment: 'wrong',
          digest: 'sha256:abc',
          scenario: 999,
          source: 'invalid',
          search: 'todo',
          guidedStage: 3,
        },
        [specification],
      ),
    ).toEqual({
      view: 'slice',
      application: 'todo',
      environment: 'production',
      digest: 'sha256:abc',
      scenario: 1,
      source: '',
      search: 'todo',
      guidedStage: 3,
    })
  })

  it('clears hidden scope when returning home', () => {
    expect(
      canonicalDashboardLocation(
        {
          view: 'home',
          application: 'todo',
          environment: 'production',
          digest: 'sha256:abc',
          scenario: 3,
          source: 'source',
          search: 'todo',
          guidedStage: 2,
        },
        [],
      ),
    ).toEqual({ ...defaultDashboardLocation, search: 'todo' })
  })
})

describe('scenario tab keyboard navigation', () => {
  it('supports arrow, Home, and End keys with wrapping', () => {
    expect(scenarioTabIndexForKey('ArrowDown', 2, 3)).toBe(0)
    expect(scenarioTabIndexForKey('ArrowUp', 0, 3)).toBe(2)
    expect(scenarioTabIndexForKey('Home', 2, 3)).toBe(0)
    expect(scenarioTabIndexForKey('End', 0, 3)).toBe(2)
    expect(scenarioTabIndexForKey('Enter', 1, 3)).toBeUndefined()
  })
})
