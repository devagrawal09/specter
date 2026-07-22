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
