import createWorkspace from './create-workspace/impl'
import { workspaceEventDefinitions } from './events'
import workspacesQuery from './workspaces-query/impl'

export const workspaceRegistrations = [
  createWorkspace,
  workspacesQuery,
] as const

export { workspaceEventDefinitions }
