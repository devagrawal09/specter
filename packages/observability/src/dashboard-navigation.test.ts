import { describe, expect, it } from 'vitest'

import {
  dashboardSearch,
  defaultDashboardLocation,
  parseDashboardLocation,
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
})
