import { runtimeSourceIdentity } from './dashboard-model'
import type { CollectedSpecification } from './specification-catalog'

export type DashboardView = 'home' | 'relationships' | 'slice'

export type DashboardLocation = {
  readonly view: DashboardView
  readonly application: string
  readonly environment: string
  readonly digest: string
  readonly scenario: number
  readonly source: string
  readonly search: string
  readonly guidedStage: 0 | 1 | 2 | 3
}

export const defaultDashboardLocation: DashboardLocation = {
  view: 'home',
  application: '',
  environment: '',
  digest: '',
  scenario: 0,
  source: '',
  search: '',
  guidedStage: 0,
}

export function parseDashboardLocation(search: string): DashboardLocation {
  const parameters = new URLSearchParams(search)
  const view = parameters.get('view')
  const scenario = Number(parameters.get('scenario') ?? 0)
  const guidedStage = Number(parameters.get('stage') ?? 0)
  return {
    view:
      view === 'slice' || view === 'relationships' || view === 'home'
        ? view
        : parameters.has('digest')
          ? 'slice'
          : 'home',
    application: parameters.get('app') ?? '',
    environment: parameters.get('env') ?? '',
    digest: parameters.get('digest') ?? '',
    scenario: Number.isInteger(scenario) && scenario >= 0 ? scenario : 0,
    source: parameters.get('source') ?? '',
    search: parameters.get('q') ?? '',
    guidedStage:
      guidedStage === 1 || guidedStage === 2 || guidedStage === 3
        ? guidedStage
        : 0,
  }
}

export function dashboardSearch(location: DashboardLocation): string {
  const parameters = new URLSearchParams()
  if (location.view !== 'home') parameters.set('view', location.view)
  if (location.application) parameters.set('app', location.application)
  if (location.environment) parameters.set('env', location.environment)
  if (location.digest) parameters.set('digest', location.digest)
  if (location.scenario) parameters.set('scenario', String(location.scenario))
  if (location.source) parameters.set('source', location.source)
  if (location.search) parameters.set('q', location.search)
  if (location.guidedStage)
    parameters.set('stage', String(location.guidedStage))
  const value = parameters.toString()
  return value ? `?${value}` : ''
}

export function canonicalDashboardLocation(
  location: DashboardLocation,
  specifications: readonly CollectedSpecification[],
): DashboardLocation {
  if (location.view === 'home')
    return {
      ...defaultDashboardLocation,
      search: location.search,
    }

  const item = specifications.find(
    (specification) => specification.digest === location.digest,
  )
  if (!item)
    return {
      ...defaultDashboardLocation,
      search: location.search,
    }

  const source =
    item.sources.find(
      (candidate) =>
        candidate.application === location.application &&
        candidate.environment === location.environment,
    ) ?? item.sources[0]
  if (!source)
    return {
      ...defaultDashboardLocation,
      search: location.search,
    }

  const scopedSources = item.sources.filter(
    (candidate) =>
      candidate.application === source.application &&
      candidate.environment === source.environment,
  )
  const selectedSource = scopedSources.some(
    (candidate) => runtimeSourceIdentity(candidate) === location.source,
  )
    ? location.source
    : ''
  const scenarioCount = item.document.scenarios.length
  const scenario = Math.max(
    0,
    Math.min(location.scenario, Math.max(0, scenarioCount - 1)),
  )

  return {
    ...location,
    application: source.application,
    environment: source.environment,
    source: selectedSource,
    scenario,
    guidedStage: location.view === 'slice' ? location.guidedStage : 0,
  }
}

export function scenarioTabIndexForKey(
  key: string,
  current: number,
  count: number,
): number | undefined {
  if (count <= 0) return undefined
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key === 'ArrowDown' || key === 'ArrowRight') return (current + 1) % count
  if (key === 'ArrowUp' || key === 'ArrowLeft')
    return (current - 1 + count) % count
  return undefined
}
