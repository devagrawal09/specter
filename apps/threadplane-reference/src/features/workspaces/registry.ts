import createWorkspace from './create-workspace/slice'
import { workspaceEventDefinitions } from './events'
import workspacesQuery from './workspaces-query/slice'

export const workspaceRegistrations = [createWorkspace, workspacesQuery] as const

export { workspaceEventDefinitions }
